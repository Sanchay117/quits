// Label placement for the debt graph: amount labels slide along their curve (and a little to either side) until
// they stop overlapping what is already placed.
import { pointOnCurve, type Point } from "./geometry.ts";

/** An axis-aligned box given by its centre. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Area two boxes share once each is grown by `padding` on every side; 0 when they do not touch. */
export function overlapArea(a: Box, b: Box, padding = 2): number {
  const overlapX = (a.width + b.width) / 2 + padding * 2 - Math.abs(a.x - b.x);
  const overlapY = (a.height + b.height) / 2 + padding * 2 - Math.abs(a.y - b.y);
  return overlapX > 0 && overlapY > 0 ? overlapX * overlapY : 0;
}

/** Rough rendered width of a label: system UI fonts average about 0.58em per character for these strings. */
export function textWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.58 + 4;
}

/** Positions along a curve tried for its label, centre first, then sideways nudges off the line. */
const ALONG = [0.5, 0.4, 0.6, 0.32, 0.68, 0.25, 0.75];
const ASIDE = [0, 12, -12];

function candidates(a: Point, b: Point, bend: number): Point[] {
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
  return ASIDE.flatMap((aside) =>
    ALONG.map((t) => {
      const p = pointOnCurve(a, b, bend, t);
      return { x: p.x + normal.x * aside, y: p.y + normal.y * aside };
    }),
  );
}

/**
 * Places a `width` x `height` label on the curve from `a` to `b` (bent by `bend`) at the first candidate that
 * overlaps nothing in `taken`, or else at the one that overlaps least, and records it in `taken`.
 */
export function placeOnCurve(a: Point, b: Point, bend: number, width: number, height: number, taken: Box[]): Point {
  let best: Box | null = null;
  let bestOverlap = Infinity;
  for (const p of candidates(a, b, bend)) {
    const box = { x: p.x, y: p.y, width, height };
    const overlap = taken.reduce((sum, other) => sum + overlapArea(box, other), 0);
    if (overlap < bestOverlap) {
      best = box;
      bestOverlap = overlap;
    }
    if (overlap === 0) break;
  }
  taken.push(best!);
  return { x: best!.x, y: best!.y };
}
