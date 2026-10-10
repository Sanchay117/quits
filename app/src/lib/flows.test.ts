import { describe, expect, it } from "vitest";
import { decomposeNets, totalFlow, type Flow } from "./flows.ts";
import { seededRandom } from "./random.ts";

/** Each member's received minus paid across the flows. */
function netsOf(flows: Flow[]): Record<string, bigint> {
  const nets: Record<string, bigint> = {};
  for (const { from, to, amount } of flows) {
    nets[from] = (nets[from] ?? 0n) - amount;
    nets[to] = (nets[to] ?? 0n) + amount;
  }
  return nets;
}

function randomBalancedNets(seed: number): Record<string, bigint> {
  const random = seededRandom(seed);
  const count = 2 + Math.floor(random() * 12);
  const nets: Record<string, bigint> = {};
  let sum = 0n;
  for (let i = 0; i < count - 1; i++) {
    const net = BigInt(Math.floor(random() * 2_000_000) - 1_000_000);
    nets[`0x${i.toString(16).padStart(40, "0")}`] = net;
    sum += net;
  }
  nets[`0x${"f".repeat(40)}`] = -sum;
  return nets;
}

describe("decomposeNets", () => {
  it("returns nothing when nobody pays", () => {
    expect(decomposeNets({})).toEqual([]);
    expect(decomposeNets({ a: 0n, b: 0n })).toEqual([]);
  });

  it("turns a single payer and receiver into one transfer", () => {
    expect(decomposeNets({ a: -5n, b: 5n })).toEqual([{ from: "a", to: "b", amount: 5n }]);
  });

  it("matches the largest payer with the largest receiver first", () => {
    const flows = decomposeNets({ a: -8n, b: -2n, c: 7n, d: 3n });
    expect(flows).toEqual([
      { from: "a", to: "c", amount: 7n },
      { from: "a", to: "d", amount: 1n },
      { from: "b", to: "d", amount: 2n },
    ]);
  });

  it("breaks ties by address, so the output does not depend on key order", () => {
    const one = decomposeNets({ b: 4n, a: 4n, c: -8n });
    const other = decomposeNets({ c: -8n, a: 4n, b: 4n });
    expect(one).toEqual(other);
    expect(one[0]).toEqual({ from: "c", to: "a", amount: 4n });
  });

  it("reproduces every net exactly with at most payers + receivers - 1 positive transfers", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const nets = randomBalancedNets(seed);
      const flows = decomposeNets(nets);
      const nonZero = Object.values(nets).filter((n) => n !== 0n).length;
      expect(flows.length).toBeLessThanOrEqual(Math.max(nonZero - 1, 0));
      expect(flows.every((f) => f.amount > 0n && f.from !== f.to)).toBe(true);
      const rebuilt = netsOf(flows);
      for (const [member, net] of Object.entries(nets)) expect(rebuilt[member] ?? 0n).toBe(net);
      const cash = Object.values(nets).reduce((sum, n) => (n > 0n ? sum + n : sum), 0n);
      expect(totalFlow(flows)).toBe(cash);
    }
  });

  it("stops when one side runs out if the nets do not balance", () => {
    expect(decomposeNets({ a: -10n, b: 4n })).toEqual([{ from: "a", to: "b", amount: 4n }]);
  });
});
