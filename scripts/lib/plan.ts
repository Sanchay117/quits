// Gas figures for estimates, and the guard every broadcasting script goes through: print the plan with its estimated
// cost first, then send only on testnet/local or with --yes on mainnet.
import { int, nativeUsdc, section, usd } from "./format.ts";
import type { Context } from "./network.ts";
import { ARC_GAS_PRICE } from "./tx.ts";

/**
 * Whole-transaction gas measured by contracts/test/GasReport.t.sol and on a local chain (scripts/local-chain.ts).
 * Batched calls (Multicall3From) share one 21,000 base cost; see batchGas.
 */
export const GAS = {
  deploy: 2_860_000n,
  /** Measured on Arc testnet (eth_estimateGas through Multicall3From, name of 15 bytes). */
  register: 100_000n,
  /** With a memo of up to 31 bytes; see issueGas for longer ones. */
  issueInvoice: 186_000n,
  acceptInvoice: 30_000n,
  /** setSolver(address(0), true): one fresh storage slot and an event. */
  setSolver: 46_000n,
  deposit: 46_000n,
  withdraw: 45_000n,
  /** settle() of 15 invoices among 6 members. */
  settle15: 541_000n,
  nativeTransfer: 21_000n,
  /** USDC ERC-20 transfer to an address that has never held USDC (measured on Arc testnet). */
  usdcTransfer: 50_000n,
  /** Memo predeploy wrapping (measured on Arc testnet). */
  memoOverhead: 20_000n,
  txBase: 21_000n,
  /** Per call inside a Multicall3From batch, on top of the call's own execution. */
  batchPerCall: 3_000n,
} as const;

/**
 * issueInvoice with a given memo: a memo over 31 bytes is stored in its own slots, about 22,500 gas per 32 bytes
 * (a 47-byte memo measured 233,690 gas on Arc testnet).
 */
export function issueGas(memo: string): bigint {
  const bytes = BigInt(new TextEncoder().encode(memo).length);
  return bytes <= 31n ? GAS.issueInvoice : GAS.issueInvoice + 22_500n * ((bytes + 31n) / 32n);
}

/** One transaction carrying `calls` (each given as its standalone transaction gas) through Multicall3From. */
export function batchGas(calls: bigint[]): bigint {
  if (calls.length === 0) return 0n;
  if (calls.length === 1) return calls[0];
  return GAS.txBase + calls.reduce((sum, g) => sum + g - GAS.txBase + GAS.batchPerCall, 0n);
}

/** Rough settle() cost: fitted to the measured 15-invoice, 6-member cycle (scripts estimate the real call when they can). */
export function settleGas(invoices: number, members: number): bigint {
  return 120_000n + 22_000n * BigInt(invoices) + 15_000n * BigInt(members);
}

export interface Plan {
  title: string;
  txCount: number;
  gas: bigint;
  /** USDC moved besides gas (6-decimal units), e.g. deposits or transfers, each with a description. */
  moves?: { what: string; units: bigint }[];
  notes?: string[];
}

/**
 * Print the plan and its estimated cost. Returns true when the script should go ahead and send: never on --dry-run,
 * and on Arc Mainnet only with --yes.
 */
export function confirmPlan(ctx: Context, plan: Plan): boolean {
  section(`Plan: ${plan.title} on ${ctx.net.label}`);
  if (plan.txCount === 0) {
    console.log("  Nothing to do.");
    return false;
  }
  console.log(`  Transactions: ${plan.txCount}`);
  console.log(
    `  Estimated gas: ${int(plan.gas)}, about ${nativeUsdc(plan.gas * ARC_GAS_PRICE)} ` +
      "(21 gwei: Arc's 20 gwei base fee plus a 1 gwei tip)",
  );
  for (const move of plan.moves ?? []) console.log(`  ${move.what}: ${usd(move.units)}`);
  for (const note of plan.notes ?? []) console.log(`  ${note}`);
  if (ctx.dryRun) {
    console.log("\nDry run: nothing sent.");
    return false;
  }
  if (ctx.mainnet && !ctx.yes) {
    console.log(
      "\nNothing sent. On Arc Mainnet gas and deposits are real USDC: check the plan above, then re-run with --yes to " +
        "broadcast it.",
    );
    return false;
  }
  console.log("");
  return true;
}
