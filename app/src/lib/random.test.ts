import { describe, expect, it } from "vitest";
import { randomNetwork, seededRandom } from "./random.ts";

const OPTIONS = { companies: 8, invoices: 40, liquidityPercent: 25, seed: 42 };

describe("randomNetwork", () => {
  it("is reproducible from its seed", () => {
    expect(randomNetwork(OPTIONS)).toEqual(randomNetwork(OPTIONS));
    expect(randomNetwork({ ...OPTIONS, seed: 43 })).not.toEqual(randomNetwork(OPTIONS));
    expect(seededRandom(1)()).toBe(seededRandom(1)());
  });

  it("produces the requested sizes, no self-invoices and amounts of $5 to $95", () => {
    const { parties, debts } = randomNetwork(OPTIONS);
    expect(parties).toHaveLength(8);
    expect(debts).toHaveLength(40);
    expect(new Set(debts.map((d) => d.id)).size).toBe(40);
    for (const debt of debts) {
      expect(debt.debtor).not.toBe(debt.creditor);
      expect(debt.amount).toBeGreaterThanOrEqual(5_000_000n);
      expect(debt.amount).toBeLessThanOrEqual(95_000_000n);
      expect(debt.amount % 10_000n).toBe(0n);
    }
  });

  it("sizes each deposit as a share of what the company owes, rounded down to cents", () => {
    const { parties, debts } = randomNetwork(OPTIONS);
    for (const party of parties) {
      const owes = debts.filter((d) => d.debtor === party.id).reduce((sum, d) => sum + d.amount, 0n);
      const exact = (owes * 25n) / 100n;
      expect(party.deposit).toBeLessThanOrEqual(exact);
      expect(exact - party.deposit).toBeLessThan(10_000n);
    }
    expect(randomNetwork({ ...OPTIONS, liquidityPercent: 0 }).parties.every((p) => p.deposit === 0n)).toBe(true);
  });
});
