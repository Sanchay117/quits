import { describe, expect, it } from "vitest";
import { displayName, initials, isoDate, refToText, shortAddress, textToRef, utf8Length } from "./format.ts";

const ADDRESS = "0x1234567890abcdef1234567890abcdef1234abcd";

describe("addresses and names", () => {
  it("shortens addresses to 0x1234…abcd", () => {
    expect(shortAddress(ADDRESS)).toBe("0x1234…abcd");
    expect(shortAddress("0x12")).toBe("0x12");
  });

  it("prefers a registered name", () => {
    expect(displayName(ADDRESS, "Ember Roasters")).toBe("Ember Roasters");
    expect(displayName(ADDRESS, "  ")).toBe("0x1234…abcd");
    expect(displayName(ADDRESS)).toBe("0x1234…abcd");
  });

  it("derives node initials", () => {
    expect(initials("Ember Roasters")).toBe("ER");
    expect(initials("Studio Meridian & Co")).toBe("SM");
    expect(initials("acme")).toBe("A");
    expect(initials("0x12ab…cdef")).toBe("12");
  });
});

describe("references", () => {
  it("round-trips short text through bytes32", () => {
    const ref = textToRef("INV-2041");
    expect(ref).toMatch(/^0x[0-9a-f]{64}$/);
    expect(refToText(ref!)).toBe("INV-2041");
  });

  it("accepts a raw bytes32 and rejects text over 32 bytes", () => {
    const raw = `0x${"ab".repeat(32)}`;
    expect(textToRef(raw)).toBe(raw);
    expect(textToRef("x".repeat(33))).toBeNull();
    expect(textToRef("€".repeat(11))).toBeNull(); // 33 bytes in UTF-8
  });

  it("shows nothing for an empty reference and short hex for binary ones", () => {
    expect(refToText(`0x${"0".repeat(64)}`)).toBe("");
    expect(refToText(`0x${"ff".repeat(32)}`)).toBe("0xffff…ffff");
    expect(refToText("not hex")).toBe("");
  });

  it("measures UTF-8 bytes like the contract does", () => {
    expect(utf8Length("abc")).toBe(3);
    expect(utf8Length("€")).toBe(3);
  });
});

describe("dates", () => {
  it("writes ISO dates in UTC and leaves 'due immediately' empty", () => {
    expect(isoDate(0n)).toBe("");
    expect(isoDate(1_700_000_000n)).toBe("2023-11-14T22:13:20.000Z");
  });
});
