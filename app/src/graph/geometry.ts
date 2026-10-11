// Pure geometry for the debt graph: curved edges, arrowheads, widths and animation staggering.

export interface Point {
  x: number;
  y: number;
}

export interface EdgeEnds {
  id: string;
  from: string;
  to: string;
}

/**
 * Perpendicular bend (px) per edge. Edges between the same two nodes, in either direction, fan out symmetrically
 * around the straight line; a lone edge gets the bend `lone` picks for it (a gentle fixed one by default).
 */
export function edgeBends(
  edges: EdgeEnds[],
  spacing = 30,
  lone: (edge: EdgeEnds) => number = () => 18,
): Map<string, number> {
  const groups = new Map<string, EdgeEnds[]>();
  for (const edge of edges) {
    const key = edge.from < edge.to ? `${edge.from}|${edge.to}` : `${edge.to}|${edge.from}`;
    groups.set(key, [...(groups.get(key) ?? []), edge]);
  }
  const bends = new Map<string, number>();
  for (const group of groups.values()) {
    if (group.length === 1) {
      bends.set(group[0].id, lone(group[0]));
      continue;
    }
    group.forEach((edge, i) => {
      // Offsets are laid out along the normal of the canonical direction; a reversed edge's own normal points the
      // other way, so its sign flips to land on the intended side.
      const canonical = (i - (group.length - 1) / 2) * spacing;
      bends.set(edge.id, edge.from < edge.to ? canonical : -canonical);
    });
  }
  return bends;
}

function towards(from: Point, to: Point, distance: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: from.x + (dx / length) * distance, y: from.y + (dy / length) * distance };
}

export function quadraticPoint(a: Point, c: Point, b: Point, t: number): Point {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}

const round = (value: number) => Math.round(value * 10) / 10;

export interface Curve {
  /** SVG path data, ending where the arrowhead begins. */
  d: string;
  /** Midpoint of the curve, for an amount label. */
  mid: Point;
  /** Arrow tip, on the target node's rim. */
  tip: Point;
  /** Direction of travel at the tip, in radians. */
  angle: number;
  /** The drawn quadratic curve, for placing moving marks on it frame by frame. */
  start: Point;
  control: Point;
  end: Point;
}

/**
 * A quadratic curve from `a` to `b`, bent sideways by `bend`, trimmed so it leaves `a`'s rim (`startGap` from its
 * centre) and its arrow tip touches `b`'s rim (`endGap`). The stroke stops short of the tip by most of the head.
 */
export function curveBetween(a: Point, b: Point, bend: number, startGap: number, endGap: number, head: number): Curve {
  const control = controlPoint(a, b, bend);
  const start = towards(a, control, startGap);
  const tip = towards(b, control, endGap);
  const end = towards(tip, control, head * 0.75);
  return {
    d: `M${round(start.x)},${round(start.y)} Q${round(control.x)},${round(control.y)} ${round(end.x)},${round(end.y)}`,
    mid: quadraticPoint(start, control, end, 0.5),
    tip,
    angle: Math.atan2(tip.y - control.y, tip.x - control.x),
    start,
    control,
    end,
  };
}

export interface Obstacle {
  center: Point;
  radius: number;
}

function controlPoint(a: Point, b: Point, bend: number): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: (a.x + b.x) / 2 - (dy / length) * bend, y: (a.y + b.y) / 2 + (dx / length) * bend };
}

/** The point at parameter `t` of the untrimmed curve from `a` to `b` bent by `bend`. */
export function pointOnCurve(a: Point, b: Point, bend: number, t: number): Point {
  return quadraticPoint(a, controlPoint(a, b, bend), b, t);
}

/** Smallest gap (px, negative when overlapping) between the curve's interior and any obstacle. */
export function curveClearance(a: Point, b: Point, bend: number, obstacles: Obstacle[]): number {
  const control = controlPoint(a, b, bend);
  let clearance = Infinity;
  for (let i = 1; i < 10; i++) {
    const p = quadraticPoint(a, control, b, i / 10);
    for (const o of obstacles) {
      clearance = Math.min(clearance, Math.hypot(p.x - o.center.x, p.y - o.center.y) - o.radius);
    }
  }
  return clearance;
}

/**
 * The first bend in `candidates` (listed in order of preference) whose curve passes every obstacle with at least
 * `margin` px to spare; if none does, the one with the most clearance. Keeps arrows from running through
 * unrelated nodes, which would read as a path through them.
 */
export function clearestBend(a: Point, b: Point, obstacles: Obstacle[], candidates: number[], margin = 6): number {
  let best = candidates[0];
  let bestClearance = -Infinity;
  for (const bend of candidates) {
    const clearance = curveClearance(a, b, bend, obstacles);
    if (clearance >= margin) return bend;
    if (clearance > bestClearance) {
      best = bend;
      bestClearance = clearance;
    }
  }
  return best;
}

/** Triangle points for an arrowhead whose tip is at `tip`, pointing along `angle`. */
export function arrowHead(tip: Point, angle: number, length: number, width: number): string {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const base = { x: tip.x - cos * length, y: tip.y - sin * length };
  const half = width / 2;
  const left = { x: base.x - sin * half, y: base.y + cos * half };
  const right = { x: base.x + sin * half, y: base.y - cos * half };
  return [tip, left, right].map((p) => `${round(p.x)},${round(p.y)}`).join(" ");
}

/** Visual share of `value` in `max` in [0, 1]. A pixel size, so float precision is fine here. */
export function share(value: bigint, max: bigint): number {
  if (max <= 0n || value <= 0n) return 0;
  if (value >= max) return 1;
  return Number((value * 10_000n) / max) / 10_000;
}

/** Stroke width for an amount: area-like (square root) scaling between `min` and `max` px. */
export function strokeWidth(amount: bigint, largest: bigint, min = 1.25, max = 9): number {
  return amount <= 0n ? 0 : min + (max - min) * Math.sqrt(share(amount, largest));
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Local, eased progress of item `index` of `count` when a phase is at `progress`: items start one after another and
 * each takes `span` of the phase, so later items begin before earlier ones finish.
 */
export function staggered(progress: number, index: number, count: number, span = 0.45): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  const step = count > 1 ? (1 - span) / (count - 1) : 0;
  return easeInOutCubic(clamp01((progress - index * step) / span));
}
