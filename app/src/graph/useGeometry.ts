// Everything about the debt graph that does not change frame to frame: node positions and sizes, edge bends, stroke
// scale and label placement. Computed once per model and size; the animation only reads it.
import { useMemo, useRef } from "react";
import { formatMoney } from "../lib/money.ts";
import { clearestBend, edgeBends, share, strokeWidth, type Obstacle, type Point } from "./geometry.ts";
import { placeOnCurve, textWidth, type Box } from "./labels.ts";
import { computeLayout } from "./layout.ts";
import type { GraphModel } from "./model.ts";

export const RING_GAP = 5;
export const RING_WIDTH = 3;
/** Long enough for every demo company's full name ("Ember Hill Roasters" is the longest). */
const MAX_LABEL_CHARS = 20;

export interface Geometry {
  positions: Map<string, Point>;
  radii: Map<string, number>;
  /** Node labels go above nodes in the upper half and below the others, away from the middle where edges meet. */
  labelAbove: Map<string, boolean>;
  /** Bend per invoice id. */
  bends: Map<string, number>;
  /** Bend per net transfer, keyed "from>to". */
  flowBends: Map<string, number>;
  /** Where amount labels go: invoices by id, transfers by "from>to". */
  edgeLabels: Map<string, Point>;
  flowLabels: Map<string, Point>;
  /** Stroke width for an amount. One scale for invoices and transfers, so their widths compare honestly. */
  stroke: (amount: bigint) => number;
  maxDeposit: bigint;
  nameFontSize: number;
}

export function shortLabel(label: string): string {
  return label.length > MAX_LABEL_CHARS ? `${label.slice(0, MAX_LABEL_CHARS - 1)}…` : label;
}

export const flowKey = (flow: { from: string; to: string }) => `${flow.from}>${flow.to}`;

function maxOf(values: bigint[]): bigint {
  return values.reduce((max, value) => (value > max ? value : max), 0n);
}

/** Node size grows with the total invoiced to and from it. */
function nodeRadii(model: GraphModel, compact: boolean): Map<string, number> {
  const volume = new Map<string, bigint>();
  for (const edge of model.edges) {
    volume.set(edge.from, (volume.get(edge.from) ?? 0n) + edge.amount);
    volume.set(edge.to, (volume.get(edge.to) ?? 0n) + edge.amount);
  }
  const largest = maxOf([...volume.values()]);
  const [base, growth] = compact ? [13, 8] : [16, 11];
  return new Map(model.nodes.map((n) => [n.id, base + growth * Math.sqrt(share(volume.get(n.id) ?? 0n, largest))]));
}

/** Thick strokes read well on a small graph and turn into a blot on a dense one. */
function maxStrokeFor(edgeCount: number): number {
  return edgeCount > 30 ? 4 : edgeCount > 15 ? 5.5 : 7;
}

/**
 * Node positions depend only on the graph's shape (who owes whom) and the drawing size, so changing amounts or
 * liquidity never moves the nodes. The previous layout seeds the next one, which keeps live updates calm.
 */
function usePositions(model: GraphModel, radii: Map<string, number>, width: number, height: number, fontSize: number) {
  const previous = useRef<Map<string, Point> | undefined>(undefined);
  const shape = `${model.nodes.map((n) => n.id).join(",")}/${model.edges.map((e) => `${e.from}>${e.to}`).join(",")}`;

  // Deliberately keyed on `shape` rather than `model`/`radii`: a new model with the same shape keeps its layout.
  return useMemo(() => {
    const nodes = model.nodes.map((n) => ({
      id: n.id,
      radius: (radii.get(n.id) ?? 16) + RING_GAP,
      labelWidth: textWidth(shortLabel(n.label), fontSize),
    }));
    const positions = computeLayout(nodes, model.edges, width, height, previous.current);
    previous.current = positions;
    return positions;
  }, [shape, width, height, fontSize]);
}

interface Frame {
  model: GraphModel;
  positions: Map<string, Point>;
  radii: Map<string, number>;
  labelAbove: Map<string, boolean>;
  nameFontSize: number;
}

/** The box a node's name (and net, once settled) occupies. */
function nodeLabelBox(frame: Frame, id: string): Box | null {
  const p = frame.positions.get(id);
  const node = frame.model.nodes.find((n) => n.id === id);
  if (!p || !node) return null;
  const ring = (frame.radii.get(id) ?? 16) + RING_GAP;
  const height = 30;
  const y = frame.labelAbove.get(id) ? p.y - ring - 4 - height / 2 : p.y + ring + 4 + height / 2;
  return { x: p.x, y, width: textWidth(shortLabel(node.label), frame.nameFontSize), height };
}

/** Other nodes and their labels, as circles an arrow should stay clear of. */
function obstaclesBesides(frame: Frame, a: string, b: string): Obstacle[] {
  const obstacles: Obstacle[] = [];
  for (const node of frame.model.nodes) {
    const center = frame.positions.get(node.id);
    if (node.id === a || node.id === b || !center) continue;
    obstacles.push({ center, radius: (frame.radii.get(node.id) ?? 16) + RING_GAP + RING_WIDTH });
    const label = nodeLabelBox(frame, node.id);
    if (!label) continue;
    for (const dx of [-label.width / 3, 0, label.width / 3]) {
      obstacles.push({ center: { x: label.x + dx, y: label.y }, radius: label.height / 3 });
    }
  }
  return obstacles;
}

/**
 * Picks bends that keep arrows clear of nodes and labels they do not belong to. Lone invoices prefer a gentle curve,
 * transfers a straight line; either bends further only when something is in the way.
 */
function routeBends(frame: Frame) {
  const route = (from: string, to: string, preferred: number[]) => {
    const a = frame.positions.get(from);
    const b = frame.positions.get(to);
    if (!a || !b) return 0;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const candidates = [...preferred, 0.2, -0.2, 0.32, -0.32].map((factor) => factor * length);
    return clearestBend(a, b, obstaclesBesides(frame, from, to), candidates);
  };
  return {
    bends: edgeBends(frame.model.edges, 30, (edge) => route(edge.from, edge.to, [0.08, -0.08])),
    flowBends: new Map(frame.model.flows.map((f) => [flowKey(f), route(f.from, f.to, [0, 0.1, -0.1])])),
  };
}

/** Amount labels, transfers first: each slides along its curve until it overlaps nothing already placed. */
function placeAmountLabels(frame: Frame, bends: Map<string, number>, flowBends: Map<string, number>) {
  const taken: Box[] = [];
  for (const node of frame.model.nodes) {
    const p = frame.positions.get(node.id);
    const ring = (frame.radii.get(node.id) ?? 16) + RING_GAP + RING_WIDTH;
    if (p) taken.push({ x: p.x, y: p.y, width: 2 * ring, height: 2 * ring });
    const label = nodeLabelBox(frame, node.id);
    if (label) taken.push(label);
  }
  const place = (from: string, to: string, bend: number, text: string, fontSize: number) => {
    const a = frame.positions.get(from);
    const b = frame.positions.get(to);
    return a && b ? placeOnCurve(a, b, bend, textWidth(text, fontSize), fontSize + 4, taken) : { x: 0, y: 0 };
  };
  const { model } = frame;
  const flowLabels = new Map(
    model.flows.map((f) => {
      const key = flowKey(f);
      return [key, place(f.from, f.to, flowBends.get(key) ?? 0, formatMoney(f.amount, model.symbol), 13)];
    }),
  );
  const edgeLabels = new Map(
    model.edges.map((e) => [e.id, place(e.from, e.to, bends.get(e.id) ?? 0, formatMoney(e.amount, model.symbol), 11)]),
  );
  return { flowLabels, edgeLabels };
}

export function useGeometry(model: GraphModel, width: number, height: number): Geometry {
  const compact = width < 560;
  const nameFontSize = compact ? 11.5 : 12.5;
  const radii = useMemo(() => nodeRadii(model, compact), [model, compact]);
  const positions = usePositions(model, radii, width, height, nameFontSize);

  return useMemo(() => {
    const labelAbove = new Map([...positions].map(([id, p]) => [id, p.y < height / 2]));
    const frame: Frame = { model, positions, radii, labelAbove, nameFontSize };
    const { bends, flowBends } = routeBends(frame);
    const largest = maxOf([...model.edges.map((e) => e.amount), ...model.flows.map((f) => f.amount)]);
    const maxStroke = maxStrokeFor(model.edges.length);
    return {
      positions,
      radii,
      labelAbove,
      bends,
      flowBends,
      ...placeAmountLabels(frame, bends, flowBends),
      stroke: (amount: bigint) => strokeWidth(amount, largest, 1.25, maxStroke),
      maxDeposit: maxOf(model.nodes.flatMap((n) => [n.deposit ?? 0n, n.depositAfter ?? 0n])),
      nameFontSize,
    };
  }, [model, positions, radii, height, nameFontSize]);
}
