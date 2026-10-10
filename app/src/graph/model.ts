// What the debt graph draws. Builders for live, historical and simulated networks all produce this shape.
import type { Flow } from "../lib/flows.ts";
import type { TokenSymbol } from "../lib/money.ts";

/** debt: accepted and due, so netting may clear it. pending: awaiting the debtor. waiting: accepted, not yet due. */
export type EdgeTone = "debt" | "pending" | "waiting";

export interface GraphNode {
  /** Lowercase address. */
  id: string;
  label: string;
  /** Deposit before the cycle (6-decimal units). Undefined when unknown: no ring is drawn. */
  deposit?: bigint;
  /** Deposit after the cycle settles. */
  depositAfter?: bigint;
  /** Net position in the cycle: positive receives, negative pays. */
  net?: bigint;
  blocked?: boolean;
}

export interface GraphEdge {
  /** Invoice id as a string. */
  id: string;
  /** Debtor (money would flow from here). */
  from: string;
  /** Creditor. */
  to: string;
  /** Outstanding before the cycle. */
  amount: bigint;
  /** How much of `amount` the cycle clears (0 when it is not part of the cycle). */
  cleared: bigint;
  tone: EdgeTone;
  title: string;
}

export interface GraphModel {
  nodes: GraphNode[];
  /** In clearing order (ascending invoice id). */
  edges: GraphEdge[];
  /** Net transfers from payers to receivers. */
  flows: Flow[];
  gross: bigint;
  cash: bigint;
  symbol: TokenSymbol;
}

export function totalOwed(model: GraphModel): bigint {
  return model.edges.reduce((sum, edge) => sum + edge.amount, 0n);
}

export function hasCycle(model: GraphModel): boolean {
  return model.gross > 0n;
}
