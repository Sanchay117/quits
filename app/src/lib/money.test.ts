import { describe, expect, it } from "vitest";
import {
  formatAmount,
  formatMoney,
  formatPercent,
  nettedAway,
  parseAmount,
  scaleByFraction,
  toDecimalString,
} from "./money.ts";

describe("formatMoney", () => {
  it("formats USDC and EURC with two decimals and grouping", () => {
    expect(formatMoney(12_400_000n)).toBe("$12.40");
    expect(formatMoney(1_234_567_890n)).toBe("$1,234.57");
    expect(formatMoney(12_400_000n, "EURC")).toBe("€12.40");
    expect(formatMoney(0n)).toBe("$0.00");
  });

  it("rounds half away from zero at the cent", () => {
    expect(formatMoney(5_000n)).toBe("$0.01");
    expect(formatMoney(4_999n)).toBe("<$0.01");
    expect(formatMoney(-5_000n)).toBe("-$0.01");
  });

  it("signs negative values, and positive ones on request", () => {
    expect(formatMoney(-3_100_000n)).toBe("-$3.10");
    expect(formatMoney(3_100_000n, "USDC", { sign: true })).toBe("+$3.10");
    expect(formatMoney(0n, "USDC", { sign: true })).toBe("$0.00");
  });

  it("shows sub-cent amounts exactly when precise", () => {
    expect(formatMoney(300_000n, "USDC", { precise: true })).toBe("$0.30");
    expect(formatMoney(123n, "USDC", { precise: true })).toBe("$0.000123");
  });

  it("handles amounts far beyond float precision", () => {
    expect(formatAmount(2n ** 96n - 1n)).toBe("79,228,162,514,264,337,593,543.95");
  });
});

describe("toDecimalString", () => {
  it("keeps every significant digit with at least two decimals", () => {
    expect(toDecimalString(12_400_000n)).toBe("12.40");
    expect(toDecimalString(12_345_678n)).toBe("12.345678");
    expect(toDecimalString(123n)).toBe("0.000123");
    expect(toDecimalString(0n)).toBe("0.00");
    expect(toDecimalString(-5_000_000n)).toBe("-5.00");
  });
});

describe("parseAmount", () => {
  it("parses whole and decimal input into 6-decimal units", () => {
    expect(parseAmount("12")).toBe(12_000_000n);
    expect(parseAmount("12.4")).toBe(12_400_000n);
    expect(parseAmount(" 0.000001 ")).toBe(1n);
    expect(parseAmount(".5")).toBe(500_000n);
    expect(parseAmount("12.")).toBe(12_000_000n);
    expect(parseAmount("1,250.50")).toBe(1_250_500_000n);
  });

  it("rejects anything that is not a non-negative amount with up to 6 decimals", () => {
    for (const bad of ["", ".", "abc", "-1", "1.1234567", "1e3", "0x10", "1.2.3"]) {
      expect(parseAmount(bad), bad).toBeNull();
    }
  });

  it("round-trips with toDecimalString", () => {
    for (const units of [1n, 999_999n, 1_000_000n, 123_456_789_012n]) {
      expect(parseAmount(toDecimalString(units))).toBe(units);
    }
  });
});

describe("percentages", () => {
  it("rounds half up to the requested decimals", () => {
    expect(formatPercent(962n, 1000n)).toBe("96.2%");
    expect(formatPercent(1n, 8n)).toBe("12.5%");
    expect(formatPercent(1n, 3n, 0)).toBe("33%");
    expect(formatPercent(2n, 3n, 2)).toBe("66.67%");
  });

  it("returns 0% for an empty whole", () => {
    expect(formatPercent(5n, 0n)).toBe("0%");
  });

  it("reports the share netted away", () => {
    expect(nettedAway(546_900_000n, 21_000_000n)).toBe("96.2%");
    expect(nettedAway(100n, 0n)).toBe("100.0%");
  });
});

describe("scaleByFraction", () => {
  it("scales without leaving integers and clamps the ends", () => {
    expect(scaleByFraction(1_000_000n, 0)).toBe(0n);
    expect(scaleByFraction(1_000_000n, 1)).toBe(1_000_000n);
    expect(scaleByFraction(1_000_000n, 0.5)).toBe(500_000n);
    expect(scaleByFraction(1_000_000n, -1)).toBe(0n);
    expect(scaleByFraction(1_000_000n, 2)).toBe(1_000_000n);
  });
});
