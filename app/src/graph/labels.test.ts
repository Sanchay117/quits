import { describe, expect, it } from "vitest";
import { overlapArea, placeOnCurve, type Box } from "./labels.ts";

describe("label placement", () => {
  it("measures overlap between boxes", () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    expect(overlapArea(a, { x: 50, y: 0, width: 10, height: 10 })).toBe(0);
    expect(overlapArea(a, { x: 5, y: 0, width: 10, height: 10 }, 0)).toBe(50);
  });

  it("uses the middle of the curve when it is free", () => {
    const taken: Box[] = [];
    const at = placeOnCurve({ x: 0, y: 0 }, { x: 100, y: 0 }, 0, 20, 10, taken);
    expect(at).toEqual({ x: 50, y: 0 });
    expect(taken).toHaveLength(1);
  });

  it("slides away from labels already placed", () => {
    const taken: Box[] = [{ x: 50, y: 0, width: 30, height: 14 }];
    const at = placeOnCurve({ x: 0, y: 0 }, { x: 200, y: 0 }, 0, 20, 10, taken);
    expect(overlapArea({ ...at, width: 20, height: 10 }, taken[0])).toBe(0);
  });
});
