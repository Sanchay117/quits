// Tests for the small pure helpers: routing, hosting, fees.
import { BaseError, encodeErrorResult } from "viem";
import { describe, expect, it } from "vitest";
import { clearingHouseAbi } from "../../../core/abi.ts";
import { MIN_FEE_PER_GAS } from "../../../core/chains.ts";
import { parseRoute } from "./router.ts";
import { sourceRepoUrl } from "./site.ts";
import { arcFees, describeError } from "./tx.ts";

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

describe("describeError", () => {
  const revert = (errorName: "PayerNotConsenting" | "InsufficientLiquidity", args: readonly unknown[]) => {
    const data = encodeErrorResult({ abi: clearingHouseAbi, errorName, args } as Parameters<typeof encodeErrorResult>[0]);
    return new BaseError("Execution reverted", { cause: Object.assign(new Error("reverted"), { data }) });
  };

  it("explains a missing solver approval in plain words", () => {
    const message = describeError(revert("PayerNotConsenting", ["0x70997970C51812dc3A010C7d01b50e0d17dc79C8"]));
    expect(message).toBe("0x7099…79C8 would pay cash in this cycle but has not approved your wallet as a solver.");
  });

  it("still explains the other settle() errors", () => {
    const member = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    expect(describeError(revert("InsufficientLiquidity", [member, 5_000_000n, 1_000_000n]))).toBe(
      "0x7099…79C8 must pay 5.00 net but has only 1.00 deposited.",
    );
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
