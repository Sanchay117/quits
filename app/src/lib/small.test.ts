// Tests for the small pure helpers: routing, hosting, fees.
import { describe, expect, it } from "vitest";
import { MIN_FEE_PER_GAS } from "../../../core/chains.ts";
import { parseRoute } from "./router.ts";
import { sourceRepoUrl } from "./site.ts";
import { arcFees } from "./tx.ts";

describe("parseRoute", () => {
  it("maps hashes to pages", () => {
    expect(parseRoute("")).toEqual({ page: "home" });
    expect(parseRoute("#/")).toEqual({ page: "home" });
    expect(parseRoute("#/network")).toEqual({ page: "network" });
    expect(parseRoute("#/how/")).toEqual({ page: "how" });
    expect(parseRoute("#/cycles")).toEqual({ page: "cycles" });
    expect(parseRoute("#/cycles/12")).toEqual({ page: "cycle", id: 12n });
  });

  it("reports unknown paths instead of guessing", () => {
    expect(parseRoute("#/cycles/abc")).toEqual({ page: "not-found", path: "cycles/abc" });
    expect(parseRoute("#/admin")).toEqual({ page: "not-found", path: "admin" });
  });
});

describe("sourceRepoUrl", () => {
  it("derives the repository from a GitHub Pages address", () => {
    expect(sourceRepoUrl("someone.github.io", "/quits/")).toBe("https://github.com/someone/quits");
  });

  it("returns null anywhere else", () => {
    expect(sourceRepoUrl("localhost", "/")).toBeNull();
    expect(sourceRepoUrl("example.com", "/quits/")).toBeNull();
    expect(sourceRepoUrl("someone.github.io", "/")).toBeNull();
  });
});

describe("arcFees", () => {
  const GWEI = 1_000_000_000n;

  it("never prices below Arc's 20 gwei floor plus the tip", () => {
    expect(arcFees({})).toEqual({ maxFeePerGas: MIN_FEE_PER_GAS + GWEI, maxPriorityFeePerGas: GWEI });
    expect(arcFees({ maxFeePerGas: 2n * GWEI, maxPriorityFeePerGas: 0n }).maxFeePerGas).toBe(MIN_FEE_PER_GAS + GWEI);
  });

  it("keeps a higher estimate", () => {
    expect(arcFees({ maxFeePerGas: 90n * GWEI, maxPriorityFeePerGas: 3n * GWEI })).toEqual({
      maxFeePerGas: 90n * GWEI,
      maxPriorityFeePerGas: 3n * GWEI,
    });
  });
});
