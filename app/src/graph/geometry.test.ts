import { describe, expect, it } from "vitest";
import {
  arrowHead,
  clearestBend,
  curveBetween,
  curveClearance,
  edgeBends,
  pointOnCurve,
  share,
  staggered,
  strokeWidth,
  type Point,
} from "./geometry.ts";

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

describe("edgeBends", () => {
  it("gives a lone edge the lone bend", () => {
    expect(edgeBends([{ id: "1", from: "a", to: "b" }]).get("1")).toBe(18);
    expect(edgeBends([{ id: "1", from: "a", to: "b" }], 30, () => -5).get("1")).toBe(-5);
  });

  it("puts opposite invoices between the same pair on opposite sides", () => {
    const bends = edgeBends([
      { id: "1", from: "a", to: "b" },
      { id: "2", from: "b", to: "a" },
    ]);
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    const first = pointOnCurve(a, b, bends.get("1")!, 0.5);
    const second = pointOnCurve(b, a, bends.get("2")!, 0.5);
    expect(Math.sign(first.y)).toBe(-Math.sign(second.y));
  });

  it("fans parallel edges out symmetrically", () => {
    const bends = edgeBends(
      [
        { id: "1", from: "a", to: "b" },
        { id: "2", from: "a", to: "b" },
        { id: "3", from: "a", to: "b" },
      ],
      30,
    );
    expect([bends.get("1"), bends.get("2"), bends.get("3")]).toEqual([-30, 0, 30]);
  });
});

describe("curves", () => {
  it("leaves the source rim and stops with the tip on the target rim", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 200, y: 0 };
    const curve = curveBetween(a, b, 0, 20, 30, 10);
    expect(curve.d.startsWith("M20,0")).toBe(true);
    expect(distance(curve.tip, b)).toBeCloseTo(30);
    expect(curve.angle).toBeCloseTo(0);
  });

  it("draws an arrowhead with its tip at the given point", () => {
    const points = arrowHead({ x: 10, y: 10 }, 0, 8, 6).split(" ");
    expect(points[0]).toBe("10,10");
    expect(points[1]).toBe("2,13");
    expect(points[2]).toBe("2,7");
  });

  it("bends around an obstacle in the way and stays straight otherwise", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 200, y: 0 };
    const candidates = [0, 40, -40];
    expect(clearestBend(a, b, [{ center: { x: 100, y: 120 }, radius: 20 }], candidates)).toBe(0);
    const blocked = [{ center: { x: 100, y: 0 }, radius: 15 }];
    const bend = clearestBend(a, b, blocked, candidates);
    expect(bend).not.toBe(0);
    expect(curveClearance(a, b, bend, blocked)).toBeGreaterThan(0);
  });
});

describe("scales and timing", () => {
  it("maps amounts to widths monotonically within the range", () => {
    expect(strokeWidth(0n, 100n)).toBe(0);
    expect(strokeWidth(100n, 100n, 1, 9)).toBe(9);
    expect(strokeWidth(25n, 100n, 1, 9)).toBe(5);
    expect(strokeWidth(10n, 100n)).toBeLessThan(strokeWidth(20n, 100n));
    expect(share(5n, 0n)).toBe(0);
    expect(share(500n, 100n)).toBe(1);
  });

  it("staggers items so earlier ones start first and all finish by the end", () => {
    expect(staggered(0, 0, 5)).toBe(0);
    expect(staggered(1, 4, 5)).toBe(1);
    expect(staggered(0.3, 0, 5)).toBeGreaterThan(staggered(0.3, 4, 5));
    let previous = 0;
    for (let p = 0; p <= 1; p += 0.05) {
      const value = staggered(p, 2, 5);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});
