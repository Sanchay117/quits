import { describe, expect, it } from "vitest";
import { sampleNetwork } from "../lib/demo.ts";
import { nettingModel, runSolver, simulatedInput } from "../lib/netting.ts";
import { countersAt } from "./CollapseView.tsx";

describe("the collapse counter", () => {
  const { parties, debts } = sampleNetwork();
  const model = nettingModel(parties, debts, runSolver(simulatedInput(parties, debts)).result, "USDC");

  it("starts at zero and lands exactly on the solver's totals", () => {
    expect(countersAt(model, 0, 0)).toEqual({ cleared: 0n, moved: 0n });
    expect(countersAt(model, 1, 0)).toEqual({ cleared: model.gross, moved: 0n });
    expect(countersAt(model, 1, 1)).toEqual({ cleared: model.gross, moved: model.cash });
  });

  it("never runs backwards", () => {
    let previous = 0n;
    for (let step = 0; step <= 40; step++) {
      const { cleared } = countersAt(model, step / 40, 0);
      expect(cleared >= previous).toBe(true);
      previous = cleared;
    }
  });
});
