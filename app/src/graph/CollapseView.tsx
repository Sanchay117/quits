// The debt graph with its running counter and replay controls: "cleared $X by moving $Y".
import { useRef, type ReactNode } from "react";
import { formatMoney, nettedAway, scaleByFraction } from "../lib/money.ts";
import { clearProgress, DebtGraph, FLOW_SPAN } from "./DebtGraph.tsx";
import { staggered } from "./geometry.ts";
import { hasCycle, totalOwed, type GraphModel } from "./model.ts";
import { useCollapse } from "./useCollapse.ts";

export interface CollapseViewProps {
  model: GraphModel;
  /** Changing it resets the animation (and replays it when `autoplay`). */
  playKey: string;
  autoplay?: boolean;
  header?: ReactNode;
  footer?: ReactNode;
  ariaLabel: string;
}

/** Amounts shown by the counter at a given point of the animation, using the same staggering as the graph. */
export function countersAt(model: GraphModel, clear: number, settle: number) {
  const progress = clearProgress(model, clear);
  const cleared = model.edges.reduce((sum, edge, i) => sum + scaleByFraction(edge.cleared, progress[i]), 0n);
  const moved = model.flows.reduce(
    (sum, flow, i) => sum + scaleByFraction(flow.amount, staggered(settle, i, model.flows.length, FLOW_SPAN)),
    0n,
  );
  return { cleared, moved };
}

export function CollapseView({ model, playKey, autoplay = false, header, footer, ariaLabel }: CollapseViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const collapse = useCollapse(playKey, autoplay, containerRef);
  const { cleared, moved } = countersAt(model, collapse.clear, collapse.settle);
  const settled = collapse.settle >= 1;
  const playable = hasCycle(model);

  return (
    <div className="collapse" ref={containerRef}>
      {header}
      <div className="collapse-stage">
        <DebtGraph model={model} clear={collapse.clear} settle={collapse.settle} ariaLabel={ariaLabel} />
        {settled && playable && (
          <div className="stamp" aria-hidden="true">
            <span className="stamp-word">Quits</span>
            <span className="stamp-note">{nettedAway(model.gross, model.cash)} netted</span>
          </div>
        )}
      </div>
      <div className="collapse-bar">
        <Counter
          model={model}
          cleared={cleared}
          moved={moved}
          settled={settled}
          started={playable && collapse.clear > 0}
        />
        {playable && (
          <div className="collapse-controls">
            <div className="segmented" role="group" aria-label="Show state">
              <button type="button" aria-pressed={collapse.clear === 0} onClick={collapse.showBefore}>
                Debts
              </button>
              <button type="button" aria-pressed={settled} onClick={collapse.showAfter}>
                Netted
              </button>
            </div>
            <button type="button" className="button button--small" onClick={collapse.play} disabled={collapse.playing}>
              <PlayIcon /> {collapse.clear === 0 ? "Net it" : "Replay"}
            </button>
          </div>
        )}
      </div>
      <Legend withRing={model.nodes.some((n) => n.deposit !== undefined)} />
      {footer}
    </div>
  );
}

interface CounterProps {
  model: GraphModel;
  cleared: bigint;
  moved: bigint;
  settled: boolean;
  /** Before the collapse starts, the counter states what is owed instead of counting from zero. */
  started: boolean;
}

/**
 * The running figures change every frame, so they are hidden from assistive technology; a separate status line
 * announces the result once, when the collapse completes.
 */
function Counter({ model, cleared, moved, settled, started }: CounterProps) {
  const money = (units: bigint) => formatMoney(units, model.symbol);
  const result =
    `Cleared ${money(model.gross)} by moving ${money(model.cash)}: ` +
    `${nettedAway(model.gross, model.cash)} of payments netted away.`;
  const status = (
    <span className="visually-hidden" role="status">
      {settled ? result : ""}
    </span>
  );
  if (!started) {
    const count = model.edges.length;
    return (
      <p className="counter">
        <span className="counter-figure">{money(totalOwed(model))}</span> owed across {count}{" "}
        {count === 1 ? "invoice" : "invoices"}
        {hasCycle(model) && (
          <span className="counter-note is-visible">Paid one by one, all of it would move as cash.</span>
        )}
        {status}
      </p>
    );
  }
  return (
    <p className="counter">
      <span aria-hidden={!settled}>
        Cleared <span className="counter-figure">{money(cleared)}</span> by moving{" "}
        <span className="counter-figure counter-figure--cash">{money(moved)}</span>
      </span>
      <span className={`counter-note${settled ? " is-visible" : ""}`} aria-hidden="true">
        {nettedAway(model.gross, model.cash)} of payments netted away
      </span>
      {status}
    </p>
  );
}

function Legend({ withRing }: { withRing: boolean }) {
  return (
    <ul className="legend" aria-label="Legend">
      <li>
        <svg width="26" height="10" aria-hidden="true">
          <line x1="1" y1="5" x2="25" y2="5" className="legend-debt" />
        </svg>
        Invoice, debtor to creditor
      </li>
      <li>
        <svg width="26" height="10" aria-hidden="true">
          <line x1="1" y1="5" x2="25" y2="5" className="legend-cash" />
        </svg>
        Net transfer that settles it
      </li>
      {withRing && (
        <li>
          <svg width="14" height="14" aria-hidden="true">
            <circle cx="7" cy="7" r="5" className="legend-ring" />
          </svg>
          Deposit
        </li>
      )}
    </ul>
  );
}

function PlayIcon() {
  return (
    <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true">
      <path d="M0 0 L10 6 L0 12 Z" fill="currentColor" />
    </svg>
  );
}
