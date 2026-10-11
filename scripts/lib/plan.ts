// Gas figures for estimates, and the guard every broadcasting script goes through: print the plan with its estimated
// cost first, then send only on testnet/local or with --yes on mainnet.
import { int, nativeUsdc, section, usd } from "./format.ts";
import type { Context } from "./network.ts";
import { ARC_GAS_PRICE } from "./tx.ts";

/**
 * Whole-transaction gas, rounded up slightly, from the demo run of 2026-10-11: gas used on a local anvil chain
 * (scripts/local-chain.ts, then fund, seed, cycle, recover) and eth_estimateGas on Arc Testnet for the same
 * transactions in their Arc form (state overrides, nothing sent): Multicall3From batches, the Memo predeploy and
 * USDC's real blocklist checks. Batched calls (Multicall3From) share one 21,000 base cost; see batchGas.
 */
export const GAS = {
  /** ClearingHouse(USDC, [EURC]): 2,952,015 used locally, 2,976,611 estimated on Arc Testnet. */
  deploy: 2_980_000n,
  /** 96,500 used (113,600 for the very first member), name of 13 to 19 bytes. */
  register: 100_000n,
  /** With a memo of up to 31 bytes (168,700 to 168,900 used); see issueGas for longer ones. */
  issueInvoice: 169_000n,
  /** 30,105 used, 30,455 estimated on Arc. */
  acceptInvoice: 30_500n,
  /** setSolver(address(0), true): one fresh storage slot and an event, 45,954 used. */
  setSolver: 46_000n,
  /** Native deposit() into an empty deposit: 46,221 used, 46,603 estimated on Arc (29,100 to top one up). */
  deposit: 46_700n,
  /** withdraw() of USDC to an existing wallet: 40,859 used locally, 53,125 estimated on Arc (real blocklist check). */
  withdraw: 54_000n,
  /** settle() of 20 invoices among 7 members: 597,488 used locally, 619,577 estimated on Arc. */
  settle20: 620_000n,
  nativeTransfer: 21_000n,
  /** USDC ERC-20 transfer to an address that has never held USDC, inside Multicall3From (49,073 each on Arc). */
  usdcTransfer: 50_000n,
  /** Memo predeploy wrapping one call: 19,503 on Arc Testnet (issueInvoice with a 47-byte memo). */
  memoOverhead: 20_000n,
  txBase: 21_000n,
  /** Per call inside a Multicall3From batch, on top of the call's own execution (3,800 to 5,300 measured on Arc). */
  batchPerCall: 5_000n,
} as const;

/**
 * issueInvoice with a given memo: a memo over 31 bytes is stored in its own slots, about 22,500 gas per 32 bytes
 * (a 36-byte memo used 213,722 gas, a 31-byte one 168,901).
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

/**
 * Rough settle() cost on Arc, fitted to the two demo cycles (20 invoices among 7 members: 619,577; 10 among 6:
 * 384,550, eth_estimateGas on Arc Testnet). cycle.ts asks the node for the real call instead.
 */
export function settleGas(invoices: number, members: number): bigint {
  return 75_000n + 22_000n * BigInt(invoices) + 15_000n * BigInt(members);
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
