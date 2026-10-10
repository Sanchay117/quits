// Every write the app makes to the clearing house, using Arc's predeploys where the network has them.
import { encodeFunctionData, parseEventLogs, parseSignature, stringToHex, type Hex } from "viem";
import { clearingHouseAbi } from "../../../core/abi.ts";
import { NATIVE_SCALE, type ArcNetwork } from "../../../core/chains.ts";
import type { Clear } from "../../../core/solver.ts";
import { fiatTokenAbi, memoAbi, multicall3FromAbi, permitTypes } from "./abis.ts";
import { isUserRejection, sendCall, type Call, type Report, type WriteContext } from "./tx.ts";

export interface ActionContext extends WriteContext {
  net: ArcNetwork;
}

/** Spread into encodeFunctionData; viem still checks each function name and its arguments against the ABI. */
const HOUSE = { abi: clearingHouseAbi } as const;

function house(ctx: ActionContext): Hex {
  if (!ctx.net.clearingHouse) throw new Error(`Quits is not deployed on ${ctx.net.label} yet.`);
  return ctx.net.clearingHouse;
}

export async function register(ctx: ActionContext, name: string, report: Report): Promise<void> {
  const data = encodeFunctionData({ ...HOUSE, functionName: "register", args: [name] });
  await sendCall(ctx, { to: house(ctx), data }, report);
}

/** USDC deposits are plain native value transfers: 18-decimal value = 6-decimal units * 1e12. */
export async function depositUsdc(ctx: ActionContext, units: bigint, report: Report): Promise<void> {
  const data = encodeFunctionData({ ...HOUSE, functionName: "deposit" });
  await sendCall(ctx, { to: house(ctx), data, value: units * NATIVE_SCALE }, report);
}

export async function withdraw(ctx: ActionContext, token: Hex, units: bigint, report: Report): Promise<void> {
  const data = encodeFunctionData({ ...HOUSE, functionName: "withdraw", args: [token, units, ctx.account] });
  await sendCall(ctx, { to: house(ctx), data }, report);
}

// ----------------------------------------------------------------------------------------------------------------
// ERC-20 deposits (EURC): EIP-2612 permit in one transaction, or approve + depositToken as a fallback
// ----------------------------------------------------------------------------------------------------------------

/** Signs an EIP-2612 permit against the FiatToken domain read from the token itself. */
async function signPermit(ctx: ActionContext, token: Hex, units: bigint, deadline: bigint) {
  const contract = { address: token, abi: fiatTokenAbi } as const;
  const [name, version, nonce] = await Promise.all([
    ctx.publicClient.readContract({ ...contract, functionName: "name" }),
    ctx.publicClient.readContract({ ...contract, functionName: "version" }),
    ctx.publicClient.readContract({ ...contract, functionName: "nonces", args: [ctx.account] }),
  ]);
  const signature = await ctx.wallet.signTypedData({
    account: ctx.account,
    domain: { name, version, chainId: ctx.net.chainId, verifyingContract: token },
    types: permitTypes,
    primaryType: "Permit",
    message: { owner: ctx.account, spender: house(ctx), value: units, nonce, deadline },
  });
  const { r, s, v, yParity } = parseSignature(signature);
  return { r, s, v: Number(v ?? BigInt(yParity + 27)) };
}

/** Signs a permit and simulates depositWithPermit with it. Nothing is sent yet. */
async function preparePermitDeposit(ctx: ActionContext, token: Hex, units: bigint, report: Report): Promise<Call> {
  report({ phase: "signing", label: "Sign the EURC permit" });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const { v, r, s } = await signPermit(ctx, token, units, deadline);
  const args = [token, units, deadline, v, r, s] as const;
  const call = { to: house(ctx), data: encodeFunctionData({ ...HOUSE, functionName: "depositWithPermit", args }) };
  await ctx.publicClient.call({ account: ctx.account, ...call });
  return call;
}

async function depositWithApproval(ctx: ActionContext, token: Hex, units: bigint, report: Report): Promise<void> {
  const spender = house(ctx);
  const allowance = await ctx.publicClient.readContract({
    address: token,
    abi: fiatTokenAbi,
    functionName: "allowance",
    args: [ctx.account, spender],
  });
  const needsApproval = allowance < units;
  if (needsApproval) {
    report({ label: "Approve EURC (1 of 2)" });
    const data = encodeFunctionData({ abi: fiatTokenAbi, functionName: "approve", args: [spender, units] });
    await sendCall(ctx, { to: token, data }, report);
  }
  report({ label: needsApproval ? "Deposit EURC (2 of 2)" : "Deposit EURC" });
  const data = encodeFunctionData({ ...HOUSE, functionName: "depositToken", args: [token, units] });
  await sendCall(ctx, { to: spender, data }, report);
}

/**
 * Deposits an ERC-20 FiatToken. Prefers a one-transaction permit deposit; if the wallet or token cannot do permits
 * (or the permit deposit would revert in simulation), falls back to approve + depositToken. The fallback is only
 * chosen before anything is sent, so a deposit can never go out twice. A rejection in the wallet stops everything.
 */
export async function depositToken(ctx: ActionContext, token: Hex, units: bigint, report: Report): Promise<void> {
  const held = await ctx.publicClient.readContract({
    address: token,
    abi: fiatTokenAbi,
    functionName: "balanceOf",
    args: [ctx.account],
  });
  if (held < units) throw new Error("Your wallet does not hold that much EURC.");
  let permitDeposit: Call | null = null;
  try {
    permitDeposit = await preparePermitDeposit(ctx, token, units, report);
  } catch (err) {
    if (isUserRejection(err)) throw err;
  }
  if (permitDeposit) {
    report({ label: "Deposit EURC" });
    await sendCall(ctx, permitDeposit, report);
  } else {
    await depositWithApproval(ctx, token, units, report);
  }
}

// ----------------------------------------------------------------------------------------------------------------
// Invoices
// ----------------------------------------------------------------------------------------------------------------

export interface NewInvoice {
  debtor: Hex;
  token: Hex;
  amount: bigint;
  dueDate: bigint;
  ref: Hex;
  memo: string;
}

/**
 * Issues an invoice. Where Arc's Memo predeploy exists, the call goes through it so the reference is indexed in a
 * Memo event alongside the invoice (the clearing house still sees the issuer as msg.sender). Returns the new id.
 */
export async function issueInvoice(ctx: ActionContext, invoice: NewInvoice, report: Report): Promise<bigint | null> {
  const target = house(ctx);
  const data = encodeFunctionData({
    ...HOUSE,
    functionName: "issueInvoice",
    args: [invoice.debtor, invoice.token, invoice.amount, invoice.dueDate, invoice.ref, invoice.memo],
  });
  const memoArgs = [target, data, invoice.ref, stringToHex(invoice.memo)] as const;
  const call = ctx.net.memo
    ? { to: ctx.net.memo, data: encodeFunctionData({ abi: memoAbi, functionName: "memo", args: memoArgs }) }
    : { to: target, data };
  const receipt = await sendCall(ctx, call, report);
  const [issued] = parseEventLogs({ abi: clearingHouseAbi, logs: receipt.logs, eventName: "InvoiceIssued" });
  return issued?.args.id ?? null;
}

type InvoiceAction = "acceptInvoice" | "rejectInvoice" | "cancelInvoice";

export async function invoiceAction(ctx: ActionContext, action: InvoiceAction, id: bigint, report: Report) {
  const data = encodeFunctionData({ ...HOUSE, functionName: action, args: [id] });
  await sendCall(ctx, { to: house(ctx), data }, report);
}

/** Accepts several invoices in one transaction through Multicall3From when available, otherwise one by one. */
export async function acceptAll(ctx: ActionContext, ids: bigint[], report: Report): Promise<void> {
  const target = house(ctx);
  if (ctx.net.multicall3From) {
    const calls = ids.map((id) => ({
      target,
      allowFailure: false,
      callData: encodeFunctionData({ ...HOUSE, functionName: "acceptInvoice", args: [id] }),
    }));
    const data = encodeFunctionData({ abi: multicall3FromAbi, functionName: "aggregate3", args: [calls] });
    await sendCall(ctx, { to: ctx.net.multicall3From, data }, report);
    return;
  }
  for (const [index, id] of ids.entries()) {
    report({ label: `Accept invoice #${id} (${index + 1} of ${ids.length})` });
    await invoiceAction(ctx, "acceptInvoice", id, report);
  }
}

// ----------------------------------------------------------------------------------------------------------------
// Netting
// ----------------------------------------------------------------------------------------------------------------

/** Sends a netting solution. Anyone may call settle(); the contract re-checks every rule. Returns the cycle id. */
export async function settle(ctx: ActionContext, token: Hex, clears: Clear[], report: Report): Promise<bigint | null> {
  const ids = clears.map((c) => c.id);
  const amounts = clears.map((c) => c.amount);
  const data = encodeFunctionData({ ...HOUSE, functionName: "settle", args: [token, ids, amounts] });
  const receipt = await sendCall(ctx, { to: house(ctx), data }, report);
  const [settled] = parseEventLogs({ abi: clearingHouseAbi, logs: receipt.logs, eventName: "CycleSettled" });
  return settled?.args.cycleId ?? null;
}
