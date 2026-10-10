// Sending transactions: Arc-safe fees, gas estimates with a margin, a balance check before signing, a receipt for
// every transaction with its explorer link, and a ledger of the gas paid in USDC.
import { BaseError, decodeErrorResult, isHex, type Hex, type TransactionReceipt } from "viem";
import { clearingHouseAbi } from "../../core/abi.ts";
import { MIN_FEE_PER_GAS, explorerTx } from "../../core/chains.ts";
import { int, nativeUsdc, section, short } from "./format.ts";
import type { Context } from "./network.ts";
import { walletFor } from "./network.ts";
import type { Signer } from "./keys.ts";

export const GWEI = 1_000_000_000n;
/** Tip per gas. Arc's base fee floor is 20 gwei; 1 gwei on top is a sane priority fee. */
export const PRIORITY_FEE = 1n * GWEI;
/** Never offer less than this per gas: Arc silently drops transactions with maxFeePerGas under 20 gwei. */
export const FEE_CAP_FLOOR = MIN_FEE_PER_GAS + 5n * GWEI;
/** What a unit of gas costs on Arc at the base fee floor plus our tip: used for every cost estimate. */
export const ARC_GAS_PRICE = MIN_FEE_PER_GAS + PRIORITY_FEE;

export interface Fees {
  baseFee: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

/** Fees for the next transaction: a cap 25% over the current base fee plus the tip, and never under 25 gwei. */
export async function currentFees(ctx: Context): Promise<Fees> {
  const block = await ctx.client.getBlock({ blockTag: "latest" });
  const baseFee = block.baseFeePerGas ?? MIN_FEE_PER_GAS;
  let maxFeePerGas = (baseFee * 5n) / 4n + PRIORITY_FEE;
  if (maxFeePerGas < FEE_CAP_FLOOR) maxFeePerGas = FEE_CAP_FLOOR;
  return { baseFee, maxFeePerGas, maxPriorityFeePerGas: PRIORITY_FEE };
}

/** Gas limit for an estimate: 20% headroom. */
export function withMargin(estimate: bigint): bigint {
  return (estimate * 6n) / 5n;
}

export class TxError extends Error {}

export interface TxRequest {
  from: Signer;
  /** Omitted for a contract creation (then `data` is the init code). */
  to?: Hex;
  data?: Hex;
  value?: bigint;
  /** One line describing the transaction, printed before it is sent. */
  label: string;
  /** Exact gas limit, skipping the estimate and its margin (e.g. 21,000 for a plain send to an EOA). */
  gasLimit?: bigint;
  /** Fees to use instead of fetching the current ones (when the caller sized `value` with them). */
  fees?: Fees;
}

export async function sendTx(ctx: Context, req: TxRequest): Promise<TransactionReceipt> {
  const { client } = ctx;
  const value = req.value ?? 0n;
  console.log(`  ${req.label}`);
  let gas = req.gasLimit;
  if (gas === undefined) {
    try {
      gas = withMargin(await client.estimateGas({ account: req.from.account, to: req.to, data: req.data, value }));
    } catch (err) {
      throw new TxError(`${req.label}: the transaction would fail: ${describeError(err)}`);
    }
  }
  const fees = req.fees ?? (await currentFees(ctx));
  const balance = await client.getBalance({ address: req.from.address });
  const upfront = gas * fees.maxFeePerGas + value;
  if (balance < upfront) {
    throw new TxError(
      `${req.label}: ${short(req.from.address)} holds ${nativeUsdc(balance)} but this transaction needs up to ` +
        `${nativeUsdc(upfront)} (${int(gas)} gas at ${fees.maxFeePerGas / GWEI} gwei${value ? ` plus ${nativeUsdc(value)}` : ""})`,
    );
  }
  const wallet = walletFor(ctx, req.from);
  const hash = await wallet.sendTransaction({
    account: req.from.account,
    chain: ctx.chain,
    to: req.to,
    data: req.data,
    value,
    gas,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  });
  const link = explorerTx(ctx.net, hash);
  console.log(`    tx ${hash}${link ? `\n       ${link}` : ""}`);
  let receipt: TransactionReceipt;
  try {
    receipt = await client.waitForTransactionReceipt({
      hash,
      timeout: 90_000,
      pollingInterval: ctx.net.name === "local" ? 100 : 500,
    });
  } catch {
    throw new TxError(
      `${req.label}: no receipt for ${hash} after 90 seconds. Arc drops transactions priced under 20 gwei without a ` +
        "receipt; check the explorer before retrying.",
    );
  }
  ctx.ledger.add(req.label, receipt);
  if (receipt.status !== "success") {
    throw new TxError(`${req.label}: reverted in block ${receipt.blockNumber} (${hash})`);
  }
  console.log(
    `    ok: block ${receipt.blockNumber}, ${int(receipt.gasUsed)} gas, ${nativeUsdc(receipt.gasUsed * receipt.effectiveGasPrice)}`,
  );
  return receipt;
}

/** A readable reason for a failed call: the contract's custom error with its arguments when the node returns it. */
export function describeError(err: unknown): string {
  if (err instanceof BaseError) {
    const withData = err.walk((e) => {
      const data = (e as { data?: unknown }).data;
      return typeof data === "string" && isHex(data) && data.length >= 10;
    }) as { data?: Hex } | null;
    const decoded = withData?.data ? decodeRevert(withData.data) : null;
    return decoded ?? err.shortMessage;
  }
  return err instanceof Error ? err.message : String(err);
}

export function decodeRevert(data: Hex): string | null {
  try {
    const result = decodeErrorResult({ abi: clearingHouseAbi, data });
    const args = (result.args ?? []) as readonly unknown[];
    return `${result.errorName}(${args.map((a) => String(a)).join(", ")})`;
  } catch {
    return null;
  }
}

interface LedgerEntry {
  label: string;
  hash: Hex;
  gasUsed: bigint;
  cost: bigint;
}

/** Every transaction a script sent, with the gas it used and what that cost in USDC. */
export class GasLedger {
  readonly entries: LedgerEntry[] = [];

  add(label: string, receipt: TransactionReceipt): void {
    this.entries.push({
      label,
      hash: receipt.transactionHash,
      gasUsed: receipt.gasUsed,
      cost: receipt.gasUsed * receipt.effectiveGasPrice,
    });
  }

  get gasUsed(): bigint {
    return this.entries.reduce((sum, e) => sum + e.gasUsed, 0n);
  }

  get cost(): bigint {
    return this.entries.reduce((sum, e) => sum + e.cost, 0n);
  }

  print(ctx: Context): void {
    section("Gas");
    if (this.entries.length === 0) {
      console.log("  No transactions sent.");
      return;
    }
    const n = this.entries.length;
    console.log(`  ${n} transaction${n === 1 ? "" : "s"}, ${int(this.gasUsed)} gas, ${nativeUsdc(this.cost)} paid`);
    if (ctx.net.name === "local") {
      console.log(`  On Arc at 21 gwei (20 gwei base fee + 1 gwei tip) this would cost ${nativeUsdc(this.gasUsed * ARC_GAS_PRICE)}`);
    }
  }
}

let activeContext: Context | null = null;

/** Register the context whose ledger is printed if the script fails part way. */
export function track(ctx: Context): Context {
  activeContext = ctx;
  return ctx;
}

/** Run a script's main function: on failure, print the reason and the gas already spent, and exit with status 1. */
export function runScript(main: () => Promise<void>): void {
  main().then(
    () => process.exit(0),
    (err: unknown) => {
      console.error(`\nError: ${err instanceof TxError ? err.message : describeError(err)}`);
      if (activeContext && activeContext.ledger.entries.length > 0) activeContext.ledger.print(activeContext);
      process.exit(1);
    },
  );
}
