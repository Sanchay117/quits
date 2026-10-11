// The debt graph: members as nodes, invoices as curved arrows, net transfers as bold arrows.
// d3-force places the nodes once per graph shape (see useGeometry); each frame only derives widths, opacities and
// dash offsets from the collapse progress.
import { useRef, useState } from "react";
import type { Flow } from "../lib/flows.ts";
import { initials } from "../lib/format.ts";
import { useElementWidth, usePrefersReducedMotion } from "../lib/hooks.ts";
import { formatMoney, scaleByFraction } from "../lib/money.ts";
import { arrowHead, clamp01, curveBetween, easeInOutCubic, quadraticPoint, share, staggered, type Curve } from "./geometry.ts";
import type { GraphEdge, GraphModel, GraphNode } from "./model.ts";
import { flowKey, RING_GAP, RING_WIDTH, shortLabel, useGeometry, type Geometry } from "./useGeometry.ts";

export interface DebtGraphProps {
  model: GraphModel;
  /** Clearing phase progress, 0 to 1. */
  clear: number;
  /** Settlement phase progress, 0 to 1. */
  settle: number;
  /** "auto" labels invoice amounts only when the graph is small enough to stay legible. */
  labels?: "auto" | "always";
  ariaLabel: string;
}

type Focus = { kind: "node" | "edge"; id: string } | null;

/** Share of the settlement phase each transfer takes to draw in; they start one after another. */
export const FLOW_SPAN = 0.6;
const MAX_AUTO_LABELS = 16;

function graphHeight(width: number): number {
  return width < 560 ? Math.round(width * 1.12) : Math.round(Math.min(600, Math.max(400, width * 0.56)));
}

/** Measures its container and draws the graph at that size, so text keeps its real pixel size on any screen. */
export function DebtGraph(props: DebtGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(containerRef);
  const height = graphHeight(width);
  return (
    <div ref={containerRef} className="graph" style={{ height: width ? height : undefined }}>
      {width > 0 && <GraphCanvas {...props} width={width} height={height} />}
    </div>
  );
}

/** Per-invoice progress of the clearing phase: invoices the cycle does not touch never move. */
export function clearProgress(model: GraphModel, clear: number): number[] {
  return model.edges.map((edge, i) => (edge.cleared > 0n ? staggered(clear, i, model.edges.length) : 0));
}

function isRelated(focus: Focus, from: string, to: string, id?: string): boolean {
  if (!focus) return true;
  if (focus.kind === "node") return from === focus.id || to === focus.id;
  return id === focus.id;
}

function nodeInFocus(node: GraphNode, focus: NonNullable<Focus>, model: GraphModel): boolean {
  if (focus.kind === "node") {
    if (node.id === focus.id) return true;
    const touches = (from: string, to: string) =>
      (from === focus.id && to === node.id) || (to === focus.id && from === node.id);
    return model.edges.some((e) => touches(e.from, e.to)) || model.flows.some((f) => touches(f.from, f.to));
  }
  const edge = model.edges.find((e) => e.id === focus.id);
  return edge !== undefined && (edge.from === node.id || edge.to === node.id);
}

/**
 * `clock` (seconds) places the moving marks (debt particles, coins, ripples) for that exact instant instead of
 * letting the browser animate them, so a frame-by-frame renderer (the demo video) gets the same picture every time.
 */
type CanvasProps = DebtGraphProps & { width: number; height: number; clock?: number };

export function GraphCanvas({ model, clear, settle, labels = "auto", ariaLabel, width, height, clock }: CanvasProps) {
  const geometry = useGeometry(model, width, height);
  const [focus, setFocus] = useState<Focus>(null);
  const reducedMotion = usePrefersReducedMotion() && clock === undefined;
  const progress = clearProgress(model, clear);
  const settled = easeInOutCubic(settle);
  const done = settle >= 1;

  const showAllLabels = labels === "always" || (width >= 560 && model.edges.length <= MAX_AUTO_LABELS);
  const labelled = (edge: GraphEdge) =>
    showAllLabels || (focus?.kind === "edge" ? focus.id === edge.id : focus?.id === edge.from || focus?.id === edge.to);
  const toggleFocus = (next: NonNullable<Focus>) => setFocus((current) => (current?.id === next.id ? null : next));

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
      onMouseLeave={() => setFocus(null)}
    >
      <g>
        {model.edges.map((edge, i) => (
          <EdgeMark
            key={edge.id}
            edge={edge}
            local={progress[i]}
            geometry={geometry}
            dimmed={!isRelated(focus, edge.from, edge.to, edge.id)}
            onFocus={(on) => setFocus(on ? { kind: "edge", id: edge.id } : null)}
          />
        ))}
      </g>
      {!reducedMotion && (
        <g aria-hidden="true">
          {model.edges.map((edge, i) => (
            <DebtParticle key={edge.id} edge={edge} index={i} local={progress[i]} geometry={geometry} clock={clock} />
          ))}
        </g>
      )}
      <g aria-hidden="true">
        {model.edges.map((edge, i) => (
          <ClearPulse key={edge.id} edge={edge} local={progress[i]} geometry={geometry} />
        ))}
      </g>
      <g>
        {model.flows.map((flow, i) => (
          <FlowMark
            key={flowKey(flow)}
            flow={flow}
            local={staggered(settle, i, model.flows.length, FLOW_SPAN)}
            geometry={geometry}
            symbol={model.symbol}
            dimmed={!isRelated(focus, flow.from, flow.to)}
          />
        ))}
        {done &&
          !reducedMotion &&
          model.flows.map((flow, i) => <FlowCoins key={flowKey(flow)} flow={flow} index={i} geometry={geometry} clock={clock} />)}
      </g>
      <g>
        {model.nodes.map((node) => (
          <NodeMark
            key={node.id}
            node={node}
            geometry={geometry}
            settle={settled}
            ripple={reducedMotion ? "off" : (clock ?? "css")}
            symbol={model.symbol}
            dimmed={focus !== null && !nodeInFocus(node, focus, model)}
            onFocus={(on) => setFocus(on ? { kind: "node", id: node.id } : null)}
            onToggle={() => toggleFocus({ kind: "node", id: node.id })}
          />
        ))}
      </g>
      <g aria-hidden="true">
        {model.edges.map((edge, i) =>
          labelled(edge) ? (
            <EdgeLabel key={edge.id} edge={edge} local={progress[i]} geometry={geometry} symbol={model.symbol} />
          ) : null,
        )}
        {model.flows.map((flow, i) => (
          <FlowLabel
            key={flowKey(flow)}
            flow={flow}
            local={staggered(settle, i, model.flows.length, FLOW_SPAN)}
            geometry={geometry}
            symbol={model.symbol}
          />
        ))}
      </g>
    </svg>
  );
}

// ------------------------------------------------------------------------------------------------------------------
// Marks
// ------------------------------------------------------------------------------------------------------------------

function headSize(strokeWidth: number) {
  return { length: Math.min(7 + strokeWidth * 1.4, 19), width: Math.min(6 + strokeWidth * 1.3, 17) };
}

/** The trimmed curve between two nodes, from rim to rim, with an arrowhead sized for `strokeWidth`. */
function shapeBetween(ends: { from: string; to: string }, geometry: Geometry, bend: number, strokeWidth: number) {
  const from = geometry.positions.get(ends.from);
  const to = geometry.positions.get(ends.to);
  if (!from || !to) return null;
  const head = headSize(strokeWidth);
  const startGap = (geometry.radii.get(ends.from) ?? 16) + 2;
  const endGap = (geometry.radii.get(ends.to) ?? 16) + RING_GAP + RING_WIDTH;
  return { curve: curveBetween(from, to, bend, startGap, endGap, head.length), head };
}

/** Width of an invoice edge as its cleared part drains away: down to the remaining amount, or a hairline. */
function edgeWidthAt(edge: GraphEdge, local: number, geometry: Geometry): number {
  const full = geometry.stroke(edge.amount);
  const remaining = edge.amount - edge.cleared;
  const end = remaining > 0n ? geometry.stroke(remaining) : 1;
  return full + (end - full) * local;
}

interface EdgeMarkProps {
  edge: GraphEdge;
  local: number;
  geometry: Geometry;
  dimmed: boolean;
  onFocus: (on: boolean) => void;
}

function EdgeMark({ edge, local, geometry, dimmed, onFocus }: EdgeMarkProps) {
  const width = edgeWidthAt(edge, local, geometry);
  const shape = shapeBetween(edge, geometry, geometry.bends.get(edge.id) ?? 0, width);
  if (!shape) return null;
  const fullyCleared = edge.cleared >= edge.amount;
  const opacity = dimmed ? 0.1 : fullyCleared ? 1 - 0.8 * local : 1;
  return (
    <g
      className={`edge edge--${edge.tone}`}
      opacity={opacity}
      onMouseEnter={() => onFocus(true)}
      onMouseLeave={() => onFocus(false)}
    >
      <title>{edge.title}</title>
      <path className="edge-line" d={shape.curve.d} strokeWidth={width} />
      <polygon
        className="edge-head"
        points={arrowHead(shape.curve.tip, shape.curve.angle, shape.head.length, shape.head.width)}
      />
      <path className="edge-hit" d={shape.curve.d} strokeWidth={Math.max(14, width + 10)} />
    </g>
  );
}

/**
 * Money owed, in motion: a dot travelling from debtor to creditor along an invoice, fading out as the invoice clears.
 * The path is built at the invoice's full width so it stays put while the stroke drains during the collapse.
 */
function DebtParticle(props: { edge: GraphEdge; index: number; local: number; geometry: Geometry; clock?: number }) {
  const { edge, index, local, geometry, clock } = props;
  if (local >= 1) return null;
  const width = geometry.stroke(edge.amount);
  const shape = shapeBetween(edge, geometry, geometry.bends.get(edge.id) ?? 0, width);
  if (!shape) return null;
  const duration = 2.4 + (index % 5) * 0.35;
  const offset = (index * 0.61) % duration;
  const r = Math.max(2.2, width / 2 + 0.8);
  return (
    <MovingDot className="particle" r={r} opacity={0.85 * (1 - local)} curve={shape.curve} duration={duration} offset={offset} clock={clock} />
  );
}

/** A dot travelling along a curve: placed for `clock` when given, otherwise animated by the browser (SMIL). */
function MovingDot(props: { className: string; r: number; opacity?: number; curve: Curve; duration: number; offset: number; clock?: number }) {
  const { className, r, opacity, curve, duration, offset, clock } = props;
  if (clock !== undefined) {
    const t = (((clock + offset) / duration) % 1 + 1) % 1;
    const at = quadraticPoint(curve.start, curve.control, curve.end, t);
    return <circle className={className} r={r} opacity={opacity} cx={at.x} cy={at.y} />;
  }
  return (
    <circle className={className} r={r} opacity={opacity}>
      <animateMotion dur={`${duration}s`} begin={`-${offset.toFixed(2)}s`} repeatCount="indefinite" path={curve.d} />
    </circle>
  );
}

/** Once a cycle has settled, lime coins keep travelling along the few transfers that settled it. */
function FlowCoins({ flow, index, geometry, clock }: { flow: Flow; index: number; geometry: Geometry; clock?: number }) {
  const width = Math.max(3.5, geometry.stroke(flow.amount) + 1.5);
  const shape = shapeBetween(flow, geometry, geometry.flowBends.get(flowKey(flow)) ?? 0, width);
  if (!shape) return null;
  const duration = 1.9;
  return (
    <g className="coins">
      {[0, 0.5].map((phase) => (
        <MovingDot
          key={phase}
          className="coin"
          r={width / 2 + 2.2}
          curve={shape.curve}
          duration={duration}
          offset={((phase + index * 0.17) % 1) * duration}
          clock={clock}
        />
      ))}
    </g>
  );
}

/** A short accent dash running from debtor to creditor while an invoice clears. */
function ClearPulse({ edge, local, geometry }: { edge: GraphEdge; local: number; geometry: Geometry }) {
  if (local <= 0 || local >= 1) return null;
  const width = geometry.stroke(edge.amount) + 2;
  const shape = shapeBetween(edge, geometry, geometry.bends.get(edge.id) ?? 0, width);
  if (!shape) return null;
  return (
    <path
      className="edge-pulse"
      d={shape.curve.d}
      pathLength={1}
      strokeWidth={width}
      strokeDasharray="0.2 2"
      strokeDashoffset={0.2 - local * 1.2}
      opacity={Math.sin(Math.PI * local)}
    />
  );
}

interface FlowMarkProps {
  flow: Flow;
  local: number;
  geometry: Geometry;
  symbol: GraphModel["symbol"];
  dimmed: boolean;
}

/** A net transfer drawing itself from payer to receiver; the arrowhead lands last. */
function FlowMark({ flow, local, geometry, symbol, dimmed }: FlowMarkProps) {
  if (local <= 0) return null;
  const width = Math.max(3.5, geometry.stroke(flow.amount) + 1.5);
  const shape = shapeBetween(flow, geometry, geometry.flowBends.get(flowKey(flow)) ?? 0, width);
  if (!shape) return null;
  const { curve, head } = shape;
  return (
    <g className="flow" opacity={dimmed ? 0.15 : 1}>
      <title>{`Net transfer: ${formatMoney(flow.amount, symbol)}`}</title>
      <path
        className="flow-line"
        d={curve.d}
        pathLength={1}
        strokeWidth={width}
        strokeDasharray="1 1"
        strokeDashoffset={1 - local}
      />
      <polygon
        className="flow-head"
        points={arrowHead(curve.tip, curve.angle, head.length + 2, head.width + 2)}
        opacity={clamp01((local - 0.7) / 0.3)}
      />
    </g>
  );
}

function FlowLabel({ flow, local, geometry, symbol }: Omit<FlowMarkProps, "dimmed">) {
  const at = geometry.flowLabels.get(flowKey(flow));
  if (local <= 0 || !at) return null;
  return (
    <text className="flow-label" x={at.x} y={at.y} dy="0.35em" opacity={local}>
      {formatMoney(flow.amount, symbol)}
    </text>
  );
}

interface EdgeLabelProps {
  edge: GraphEdge;
  local: number;
  geometry: Geometry;
  symbol: GraphModel["symbol"];
}

/** An invoice's amount; while it clears, it fades out (fully cleared) or switches to what remains. */
function EdgeLabel({ edge, local, geometry, symbol }: EdgeLabelProps) {
  const at = geometry.edgeLabels.get(edge.id);
  const remaining = edge.amount - edge.cleared;
  const opacity = remaining > 0n ? 1 : 1 - local;
  if (!at || opacity <= 0.02) return null;
  return (
    <text className="edge-label" x={at.x} y={at.y} dy="0.35em" opacity={opacity}>
      {formatMoney(local < 0.5 ? edge.amount : remaining, symbol)}
    </text>
  );
}

function nodeTitle(node: GraphNode, symbol: GraphModel["symbol"]): string {
  const lines = [node.label];
  if (node.deposit !== undefined) lines.push(`Deposit before: ${formatMoney(node.deposit, symbol)}`);
  if (node.depositAfter !== undefined) lines.push(`Deposit after: ${formatMoney(node.depositAfter, symbol)}`);
  if (node.net !== undefined) lines.push(`Net: ${formatMoney(node.net, symbol, { sign: true })}`);
  if (node.blocked) lines.push("On the blocklist: excluded from netting");
  return lines.join("\n");
}

interface DepositRingProps {
  node: GraphNode;
  radius: number;
  settle: number;
  maxDeposit: bigint;
}

/** The deposit as an arc around the node; it moves from before to after as the transfers land. */
function DepositRing({ node, radius, settle, maxDeposit }: DepositRingProps) {
  if (node.deposit === undefined) return null;
  const after = node.depositAfter ?? node.deposit;
  const current = node.deposit + scaleByFraction(after - node.deposit, settle);
  const circumference = 2 * Math.PI * radius;
  const arc = circumference * share(current, maxDeposit);
  return (
    <>
      <circle className="node-ring-track" r={radius} strokeWidth={RING_WIDTH} />
      <circle
        className="node-ring"
        r={radius}
        strokeWidth={RING_WIDTH}
        strokeDasharray={`${arc.toFixed(2)} ${circumference.toFixed(2)}`}
        transform="rotate(-90)"
      />
    </>
  );
}

interface NodeMarkProps {
  node: GraphNode;
  geometry: Geometry;
  /** Eased settlement progress. */
  settle: number;
  symbol: GraphModel["symbol"];
  dimmed: boolean;
  onFocus: (on: boolean) => void;
  onToggle: () => void;
  /** "css": the browser animates the ripple; a number: drawn for that clock (seconds); "off": none. */
  ripple: "css" | "off" | number;
}

const RIPPLE_SECONDS = 2.6;

/** Scale and opacity of a ripple at `clock`, matching the node-ripple keyframes in graph.css. */
function rippleAt(clock: number, delay: number) {
  const p = ((((clock - delay) / RIPPLE_SECONDS) % 1) + 1) % 1;
  const k = Math.min(p / 0.55, 1);
  const eased = 1 - (1 - k) ** 3;
  return { scale: 1 + 0.7 * eased, opacity: 0.7 * (1 - k) };
}

function NodeMark({ node, geometry, settle, symbol, dimmed, onFocus, onToggle, ripple }: NodeMarkProps) {
  const position = geometry.positions.get(node.id);
  const radius = geometry.radii.get(node.id) ?? 16;
  if (!position) return null;
  const ring = radius + RING_GAP;
  const above = geometry.labelAbove.get(node.id) ?? false;
  // Name nearest the node, the net beyond it, on whichever side faces away from the middle.
  const nameY = above ? -(ring + 9) : ring + 17;
  const netY = above ? -(ring + 23) : ring + 31;
  const showNet = node.net !== undefined && node.net !== 0n && settle > 0;
  return (
    <g
      className={`node${node.blocked ? " node--blocked" : ""}`}
      transform={`translate(${position.x.toFixed(1)},${position.y.toFixed(1)})`}
      opacity={dimmed ? 0.3 : 1}
      onMouseEnter={() => onFocus(true)}
      onClick={onToggle}
    >
      <title>{nodeTitle(node, symbol)}</title>
      {showNet && settle >= 1 && ripple !== "off" && (
        <circle
          className={`node-ripple ${node.net! > 0n ? "node-ripple--in" : "node-ripple--out"}${ripple === "css" ? "" : " node-ripple--still"}`}
          aria-hidden="true"
          {...(ripple === "css"
            ? { r: ring + RING_WIDTH }
            : (() => {
                const { scale, opacity } = rippleAt(ripple, node.net! > 0n ? 0 : 0.4);
                return { r: (ring + RING_WIDTH) * scale, opacity };
              })())}
        />
      )}
      <DepositRing node={node} radius={ring} settle={settle} maxDeposit={geometry.maxDeposit} />
      <circle className="node-body" r={radius} />
      <text className="node-initials" dy="0.35em" fontSize={Math.round(radius * 0.62)}>
        {initials(node.label)}
      </text>
      <text className="node-label" y={nameY} fontSize={geometry.nameFontSize}>
        {shortLabel(node.label)}
      </text>
      {showNet && (
        <text className={`node-net ${node.net! > 0n ? "node-net--in" : "node-net--out"}`} y={netY} opacity={settle}>
          {formatMoney(node.net!, symbol, { sign: true })}
        </text>
      )}
    </g>
  );
}
