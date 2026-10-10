// Force-directed placement of the debt graph's nodes. d3-force only computes positions; React draws the SVG.
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from "d3-force";
import type { Point } from "./geometry.ts";

export interface LayoutNode {
  id: string;
  radius: number;
  /** Width of the name label under the node, so labels do not collide either. */
  labelWidth: number;
}

export interface LayoutLink {
  from: string;
  to: string;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  radius: number;
  labelWidth: number;
}

const TICKS = 320;
/** Room under a node for its name and net labels. */
const LABEL_DROP = 36;
/** The force layout comes out roughly round; a wide card may stretch it this much more along one axis. */
const MAX_STRETCH = 1.7;
/** Small graphs are spread out, but not beyond this factor. */
const MAX_SCALE = 2;

/** A small deterministic PRNG, so the same graph always gets the same layout. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** A layout seeded from the previous one where possible, otherwise from an ellipse matching the box. */
function initialPositions(
  nodes: LayoutNode[],
  width: number,
  height: number,
  previous?: Map<string, Point>,
): SimNode[] {
  return nodes.map((node, i) => {
    const kept = previous?.get(node.id);
    const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
    return {
      ...node,
      x: kept?.x ?? width / 2 + width * 0.36 * Math.cos(angle),
      y: kept?.y ?? height / 2 + height * 0.34 * Math.sin(angle),
    };
  });
}

/** Clamps into [min, max]; if the range is empty (box too small), the middle of it. */
function clamp(value: number, min: number, max: number): number {
  return min > max ? (min + max) / 2 : Math.min(Math.max(value, min), max);
}

/**
 * Scales and centres the positions into the box. Each axis may stretch a little beyond the other so a round layout
 * fills a wide card. Labels do not scale with positions, so every node is finally clamped to keep its label inside.
 * Labels sit above or below a node depending on where it lands, so both sides keep room for them.
 */
function fitToBox(nodes: SimNode[], width: number, height: number, padding: number): Map<string, Point> {
  const halfWidth = (n: SimNode) => Math.max(n.radius, n.labelWidth / 2);
  const halfHeight = (n: SimNode) => n.radius + LABEL_DROP;
  const minX = Math.min(...nodes.map((n) => n.x! - halfWidth(n)));
  const maxX = Math.max(...nodes.map((n) => n.x! + halfWidth(n)));
  const minY = Math.min(...nodes.map((n) => n.y! - halfHeight(n)));
  const maxY = Math.max(...nodes.map((n) => n.y! + halfHeight(n)));
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);

  const fitX = (width - 2 * padding) / spanX;
  const fitY = (height - 2 * padding) / spanY;
  const uniform = Math.min(fitX, fitY);
  const scaleX = Math.min(fitX, uniform * MAX_STRETCH, MAX_SCALE);
  const scaleY = Math.min(fitY, uniform * MAX_STRETCH, MAX_SCALE);
  const offsetX = (width - spanX * scaleX) / 2 - minX * scaleX;
  const offsetY = (height - spanY * scaleY) / 2 - minY * scaleY;

  return new Map(
    nodes.map((n) => [
      n.id,
      {
        x: clamp(n.x! * scaleX + offsetX, padding + halfWidth(n), width - padding - halfWidth(n)),
        y: clamp(n.y! * scaleY + offsetY, padding + halfHeight(n), height - padding - halfHeight(n)),
      },
    ]),
  );
}

/**
 * Runs the simulation to rest synchronously. Seeding from `previous` keeps nodes roughly in place when the graph
 * changes a little (a new invoice arrives), so live updates do not reshuffle the picture.
 */
export function computeLayout(
  nodes: LayoutNode[],
  links: LayoutLink[],
  width: number,
  height: number,
  previous?: Map<string, Point>,
): Map<string, Point> {
  if (nodes.length === 0) return new Map();
  const simNodes = initialPositions(nodes, width, height, previous);
  const known = new Set(nodes.map((n) => n.id));
  const pairs = new Map<string, { source: string; target: string }>();
  for (const link of links) {
    if (!known.has(link.from) || !known.has(link.to) || link.from === link.to) continue;
    const key = link.from < link.to ? `${link.from}|${link.to}` : `${link.to}|${link.from}`;
    pairs.set(key, { source: link.from, target: link.to });
  }
  const spread = Math.min(width, height);
  const simulation = forceSimulation<SimNode>(simNodes)
    .randomSource(lcg(nodes.length * 7919 + links.length))
    .force(
      "link",
      forceLink<SimNode, { source: string; target: string }>([...pairs.values()])
        .id((n) => n.id)
        .distance(spread * 0.32)
        .strength(0.35),
    )
    .force("charge", forceManyBody<SimNode>().strength(-spread * 1.6))
    .force("collide", forceCollide<SimNode>((n) => Math.max(n.radius + 18, n.labelWidth / 2 + 8)).strength(0.9))
    .force("x", forceX<SimNode>(width / 2).strength(0.07))
    .force("y", forceY<SimNode>(height / 2).strength(0.1))
    .stop();
  for (let i = 0; i < TICKS; i++) simulation.tick();
  return fitToBox(simNodes, width, height, 18);
}
