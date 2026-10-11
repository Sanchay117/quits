import { describe, expect, it } from "vitest";
import { MAX_BATCH, checkSolution, type Obligation, type SolveInput } from "../../../core/solver.ts";
import { totalFlow } from "./flows.ts";
import { sampleNetwork } from "./demo.ts";
import { exceedsBatch, limitToBatch, nettingModel, runSolver, simulatedInput } from "./netting.ts";
import { randomNetwork, seededRandom } from "./random.ts";

/**
 * `count` invoices around a ring of `members`: invoice i is owed by member i to member i + 1. With equal amounts and a
 * count that is a multiple of `members`, every member owes what it is owed, so it all nets away with no cash.
 */
function ring(
  count: number,
  members: number,
  liquidity: (i: number) => bigint = () => 0n,
  amount: (i: number) => bigint = () => 1_000_000n,
): SolveInput {
  const name = (i: number) => `0x${(i % members).toString(16).padStart(40, "0")}`;
  const obligations: Obligation[] = [];
  for (let i = 1; i <= count; i++) {
    obligations.push({ id: BigInt(i), debtor: name(i), creditor: name(i + 1), amount: amount(i) });
  }
  const deposits = Object.fromEntries(Array.from({ length: members }, (_, i) => [name(i), liquidity(i)]));
  return { obligations, liquidity: deposits, blocked: [] };
}

describe("cycles larger than one settle() call", () => {
  it("are flagged before anything is sent", () => {
    const input = ring(300, 30);
    const netting = runSolver(input);
    expect(netting.result.clears).toHaveLength(300);
    expect(netting.result.cash).toBe(0n);
    expect(exceedsBatch(netting.result)).toBe(true);
    expect(netting.verified).toBe(false);
    expect(netting.errors[0]).toMatch(/^BatchTooLarge/);
  });

  it("can be settled in parts: the oldest MAX_BATCH invoices give a valid cycle for the whole network", () => {
    const random = seededRandom(42);
    const input = ring(
      300,
      30,
      () => BigInt(Math.floor(random() * 5)) * 1_000_000n,
      (i) => BigInt(1 + (i % 7)) * 1_000_000n,
    );
    // Shuffle so the helper has to pick the lowest ids itself.
    const shuffled = { ...input, obligations: [...input.obligations].sort(() => random() - 0.5) };
    const limited = limitToBatch(shuffled);
    expect(limited.obligations).toHaveLength(MAX_BATCH);
    expect(limited.obligations.map((o) => o.id)).toEqual(Array.from({ length: MAX_BATCH }, (_, i) => BigInt(i + 1)));

    const netting = runSolver(limited);
    expect(netting.verified).toBe(true);
    expect(exceedsBatch(netting.result)).toBe(false);
    expect(netting.result.gross).toBeGreaterThan(0n);
    // Still valid against every eligible invoice and the same deposits, which is what settle() sees.
    expect(checkSolution(input, netting.result.clears).ok).toBe(true);
  });

  it("leaves smaller inputs alone", () => {
    const input = ring(20, 5);
    expect(limitToBatch(input).obligations).toEqual(input.obligations);
    expect(exceedsBatch(runSolver(input).result)).toBe(false);
  });
});

describe("the sample network on Home", () => {
  it("clears everything and moves only the net differences", () => {
    const { parties, debts } = sampleNetwork();
    const netting = runSolver(simulatedInput(parties, debts));
    expect(netting.verified).toBe(true);
    expect(netting.result.gross).toBe(546_900_000n);
    expect(netting.result.cash).toBe(21_000_000n);
    expect(netting.result.uncleared).toBe(0n);
  });
});

describe("nettingModel", () => {
  it("carries the solver's result onto the graph", () => {
    const { parties, debts } = randomNetwork({ companies: 9, invoices: 30, liquidityPercent: 15, seed: 7 });
    const { result } = runSolver(simulatedInput(parties, debts));
    const model = nettingModel(parties, debts, result, "USDC");

    expect(model.edges.map((e) => e.id)).toEqual([...debts].map((d) => d.id.toString()));
    expect(model.edges.reduce((sum, e) => sum + e.cleared, 0n)).toBe(result.gross);
    expect(model.edges.every((e) => e.cleared >= 0n && e.cleared <= e.amount)).toBe(true);
    expect(totalFlow(model.flows)).toBe(result.cash);
    for (const node of model.nodes) {
      expect(node.depositAfter).toBe(node.deposit! + (result.nets[node.id] ?? 0n));
      expect(node.depositAfter! >= 0n).toBe(true);
    }
  });

  it("draws the network as it stands when there is no result yet", () => {
    const { parties, debts } = sampleNetwork();
    const model = nettingModel(parties, debts, null, "USDC");
    expect(model.flows).toEqual([]);
    expect(model.gross).toBe(0n);
    expect(model.edges.every((e) => e.cleared === 0n)).toBe(true);
  });
});
