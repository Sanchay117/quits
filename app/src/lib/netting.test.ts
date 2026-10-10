import { describe, expect, it } from "vitest";
import { totalFlow } from "./flows.ts";
import { sampleNetwork } from "./demo.ts";
import { nettingModel, runSolver, simulatedInput } from "./netting.ts";
import { randomNetwork } from "./random.ts";

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
