// Runs the shared solver and turns its result into the debt graph's model.
import { checkSolution, solve, type SolveInput, type SolveResult } from "../../../core/solver.ts";
import type { EdgeTone, GraphEdge, GraphModel, GraphNode } from "../graph/model.ts";
import { decomposeNets } from "./flows.ts";
import { formatMoney, type TokenSymbol } from "./money.ts";

/** A member of a network as the graph and the solver see it. `id` is a lowercase address. */
export interface Party {
  id: string;
  name: string;
  deposit: bigint;
  blocked?: boolean;
}

/** An invoice as the graph sees it: `amount` is what is outstanding. */
export interface Debt {
  id: bigint;
  debtor: string;
  creditor: string;
  amount: bigint;
  memo?: string;
  tone?: EdgeTone;
}

export interface Netting {
  result: SolveResult;
  /** The result passed checkSolution(), which mirrors settle()'s rules. */
  verified: boolean;
  errors: string[];
  millis: number;
}

export function runSolver(input: SolveInput): Netting {
  const startedAt = performance.now();
  const result = solve(input);
  const millis = performance.now() - startedAt;
  const check = checkSolution(input, result.clears);
  return { result, verified: check.ok, errors: check.errors, millis };
}

/** Solver input for a simulated network: every debt is eligible, deposits are the liquidity. */
export function simulatedInput(parties: Party[], debts: Debt[]): SolveInput {
  return {
    obligations: debts.map(({ id, debtor, creditor, amount }) => ({ id, debtor, creditor, amount })),
    liquidity: Object.fromEntries(parties.map((p) => [p.id, p.deposit])),
    blocked: parties.filter((p) => p.blocked).map((p) => p.id),
  };
}

export function debtTitle(debt: Debt, nameOf: (id: string) => string, symbol: TokenSymbol): string {
  const memo = debt.memo ? `: ${debt.memo}` : "";
  const amount = formatMoney(debt.amount, symbol);
  return `Invoice #${debt.id}. ${nameOf(debt.debtor)} owes ${nameOf(debt.creditor)} ${amount}${memo}`;
}

/**
 * The graph of `debts` before and after a solver result: each edge knows how much the result clears, each node its
 * deposit before and after, and the nets are drawn as a few payer to receiver transfers.
 */
export function nettingModel(
  parties: Party[],
  debts: Debt[],
  result: SolveResult | null,
  symbol: TokenSymbol,
): GraphModel {
  const names = new Map(parties.map((p) => [p.id, p.name]));
  const nameOf = (id: string) => names.get(id) ?? id;
  const clears = new Map(result?.clears.map((c) => [c.id, c.amount]));
  const nets = result?.nets ?? {};
  const touched = new Set(debts.flatMap((d) => [d.debtor, d.creditor]));

  const nodes: GraphNode[] = parties
    .filter((p) => touched.has(p.id))
    .map((p) => ({
      id: p.id,
      label: p.name,
      deposit: p.deposit,
      depositAfter: p.deposit + (nets[p.id] ?? 0n),
      net: result ? (nets[p.id] ?? 0n) : undefined,
      blocked: p.blocked,
    }));
  const edges: GraphEdge[] = [...debts]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((debt) => ({
      id: debt.id.toString(),
      from: debt.debtor,
      to: debt.creditor,
      amount: debt.amount,
      cleared: clears.get(debt.id) ?? 0n,
      tone: debt.tone ?? "debt",
      title: debtTitle(debt, nameOf, symbol),
    }));
  return {
    nodes,
    edges,
    flows: result ? decomposeNets(nets) : [],
    gross: result?.gross ?? 0n,
    cash: result?.cash ?? 0n,
    symbol,
  };
}
