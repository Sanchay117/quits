// Sending transactions: simulate, estimate, price for Arc, sign, wait for the (final) receipt.
import {
  BaseError,
  decodeErrorResult,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { clearingHouseAbi } from "../../../core/abi.ts";
import { MIN_FEE_PER_GAS } from "../../../core/chains.ts";
import { shortAddress } from "./format.ts";
import { toDecimalString } from "./money.ts";

export type TxPhase = "idle" | "preparing" | "signing" | "pending" | "success" | "error";

export interface TxProgress {
  phase: TxPhase;
  /** What is being done, e.g. "Deposit USDC" or "Approve EURC (1 of 2)". */
  label?: string;
  hash?: Hex;
  blockNumber?: bigint;
  message?: string;
}

export type Report = (update: Partial<TxProgress>) => void;

export interface Call {
  to: Hex;
  data: Hex;
  value?: bigint;
}

export interface WriteContext {
  account: Hex;
  publicClient: PublicClient;
  wallet: WalletClient;
}

const ONE_GWEI = 1_000_000_000n;

export interface Fees {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

/**
 * Arc silently drops transactions whose maxFeePerGas is under its 20 gwei base fee floor, so the cap never goes
 * below the floor plus the tip, whatever the node estimates.
 */
export function arcFees(estimate: Partial<Fees>): Fees {
  const atLeast = (value: bigint | undefined, floor: bigint) => (value !== undefined && value > floor ? value : floor);
  const tip = atLeast(estimate.maxPriorityFeePerGas, ONE_GWEI);
  return { maxFeePerGas: atLeast(estimate.maxFeePerGas, MIN_FEE_PER_GAS + tip), maxPriorityFeePerGas: tip };
}

async function feesFor(client: PublicClient): Promise<Fees> {
  try {
    return arcFees(await client.estimateFeesPerGas());
  } catch {
    return arcFees({});
  }
}

/** Simulates the call (a revert surfaces here, before the wallet is asked), then sends it and waits for inclusion. */
export async function sendCall(ctx: WriteContext, call: Call, report: Report): Promise<TransactionReceipt> {
  const request = { account: ctx.account, to: call.to, data: call.data, value: call.value };
  report({ phase: "preparing", hash: undefined, blockNumber: undefined });
  await ctx.publicClient.call(request);
  const gas = ((await ctx.publicClient.estimateGas(request)) * 12n) / 10n;
  const fees = await feesFor(ctx.publicClient);

  report({ phase: "signing" });
  const hash = await ctx.wallet.sendTransaction({ ...request, chain: ctx.wallet.chain, gas, ...fees });

  report({ phase: "pending", hash });
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("The transaction was included but reverted.");
  report({ blockNumber: receipt.blockNumber });
  return receipt;
}

// ----------------------------------------------------------------------------------------------------------------
// Errors
// ----------------------------------------------------------------------------------------------------------------

function revertData(err: unknown): Hex | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const inner = err.walk((e) => typeof e === "object" && e !== null && "data" in e) as { data?: unknown } | null;
  const data = inner?.data;
  const hex = typeof data === "object" && data !== null && "data" in data ? (data as { data: unknown }).data : data;
  return typeof hex === "string" && /^0x[0-9a-fA-F]{8,}$/.test(hex) ? (hex as Hex) : undefined;
}

export function isUserRejection(err: unknown): boolean {
  if (err instanceof BaseError) {
    return Boolean(err.walk((e) => (e as { code?: number }).code === 4001));
  }
  return (err as { code?: number })?.code === 4001;
}

const amount = (value: unknown) => toDecimalString(value as bigint);

/** Plain-language messages for the clearing house's custom errors. */
const CONTRACT_ERRORS: Record<string, (args: readonly unknown[]) => string> = {
  InsufficientLiquidity: ([member, needed, available]) =>
    `${shortAddress(String(member))} must pay ${amount(needed)} net but has only ${amount(available)} deposited.`,
  InsufficientBalance: ([available, requested]) =>
    `You asked for ${amount(requested)} but only ${amount(available)} is deposited.`,
  MemberBlocked: ([member]) => `${shortAddress(String(member))} is on the blocklist and cannot take part.`,
  PayerNotConsenting: ([member]) =>
    `${shortAddress(String(member))} would pay cash in this cycle but has not approved your wallet as a solver.`,
  InvoiceNotDue: ([id]) => `Invoice #${id} is not due yet.`,
  InvoiceNotOpen: ([id]) => `Invoice #${id} is not open (it may have been cleared already).`,
  ClearExceedsOutstanding: ([id]) => `The amount for invoice #${id} is more than what is still outstanding.`,
  TokenMismatch: ([id]) => `Invoice #${id} is in a different token.`,
  NotDebtor: ([id]) => `Only the debtor can accept or reject invoice #${id}.`,
  NotCreditor: ([id]) => `Only the creditor can cancel invoice #${id}.`,
  NotPending: ([id]) => `Invoice #${id} is no longer pending.`,
  UnsupportedToken: () => "That token is not supported by the clearing house.",
  BadAmount: () => "The amount is not valid (USDC deposits must be whole 6-decimal units).",
  BadCounterparty: () => "The counterparty address is not valid (it cannot be empty or yourself).",
  BadName: () => "Names must be 1 to 48 bytes.",
  MemoTooLong: () => "The memo is longer than 140 bytes.",
  EmptySolution: () => "There is nothing to settle.",
  BatchTooLarge: () => "A cycle can clear at most 256 invoices.",
  IdsNotAscending: () => "Invoice ids must be strictly ascending.",
  TransferFailed: () => "The token transfer failed. Check your balance and allowance.",
};

function decodedRevert(err: unknown): string | null {
  const data = revertData(err);
  if (!data) return null;
  try {
    const decoded = decodeErrorResult({ abi: clearingHouseAbi, data });
    const args = (decoded.args ?? []) as readonly unknown[];
    // viem also decodes Solidity's built-in Error(string) and Panic(uint256), which the ABI's types leave out.
    const name: string = decoded.errorName;
    if (name === "Error") return String(args[0]);
    return CONTRACT_ERRORS[name]?.(args) ?? `The contract rejected it: ${name}.`;
  } catch {
    return null;
  }
}

/** A short, human message for anything a write can throw. */
export function describeError(err: unknown): string {
  if (isUserRejection(err)) return "You rejected the request in your wallet.";
  const decoded = decodedRevert(err);
  if (decoded) return decoded;
  if (err instanceof BaseError) return err.shortMessage;
  if (err instanceof Error) return err.message.split("\n")[0];
  return String(err);
}
