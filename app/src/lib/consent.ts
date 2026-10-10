// Solver consent: settle() may take cash from a member's deposit only when the member sends the cycle itself or has
// approved the sender (setSolver), or approved anyone (setSolver(0x0, true)). Pure helpers for the pages.
import { getAddress, isAddress, type Hex } from "viem";
import type { SolveInput } from "../../../core/solver.ts";
import { ANY_SOLVER, lc, type ChainState, type Member } from "../../../core/state.ts";

/** Two optional accounts are the same: both absent, or the same address in any letter case. */
export function sameAccount(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return lc(a) === lc(b);
}

export interface LeftOut {
  /** Members whose deposit the solver could not use. */
  count: number;
  /** Sum of those deposits, 6-decimal units. */
  total: bigint;
}

/**
 * Deposits the solver had to leave out because their owners have not approved the state's submitter (or anyone):
 * members that owe on a due, accepted invoice between unblocked members, hold a deposit in `token`, and are not
 * drawableBySubmitter. Deposits of members that owe nothing due could not have paid anything anyway, so they do not
 * count.
 */
export function depositsLeftOut(state: ChainState, token: string, input: SolveInput): LeftOut {
  const key = lc(token);
  const blocked = new Set([...(input.blocked ?? [])].map(lc));
  const debtors = new Set(
    input.obligations
      .filter((o) => !blocked.has(lc(o.debtor)) && !blocked.has(lc(o.creditor)))
      .map((o) => lc(o.debtor)),
  );
  let count = 0;
  let total = 0n;
  for (const [address, member] of Object.entries(state.members)) {
    if (member.drawableBySubmitter || !debtors.has(lc(address))) continue;
    const deposit = member.balances[key] ?? 0n;
    if (deposit <= 0n) continue;
    count += 1;
    total += deposit;
  }
  return { count, total };
}

/** Who may send cycles that draw on a member's deposit, as the members table shows it. */
export type SolverAccess = "anyone" | "approved-you" | "approved-only";

export function solverAccess(member: Member, submitter: string | null): SolverAccess {
  if (member.allowsAnySolver) return "anyone";
  const isSubmitter = submitter !== null && sameAccount(member.address, submitter);
  return member.drawableBySubmitter && !isSubmitter ? "approved-you" : "approved-only";
}

export const SOLVER_ACCESS_LABEL: Record<SolverAccess, string> = {
  anyone: "Anyone",
  "approved-you": "Approved, incl. you",
  "approved-only": "Approved only",
};

/** The solver address typed into the approval form, or what is wrong with it. */
export function parseSolverAddress(text: string, me: string): Hex | string {
  const value = text.trim();
  if (!isAddress(value, { strict: false })) return "Enter a 0x address of 40 hex characters.";
  if (lc(value) === lc(ANY_SOLVER)) return "The zero address means anyone: use the switch above instead.";
  if (lc(value) === lc(me)) return "You can always settle your own cycles; no approval needed.";
  return getAddress(value);
}

export interface SolverSetLog {
  solver: Hex;
  allowed: boolean;
}

/**
 * Solvers a member has approved and not revoked, from its SolverSet events in chain order (the last event per solver
 * wins). The zero address (anyone) is left out; the switch shows it. Sorted by address for a stable list.
 */
export function currentApprovals(logs: SolverSetLog[]): Hex[] {
  const latest = new Map<string, { solver: Hex; allowed: boolean }>();
  for (const log of logs) latest.set(lc(log.solver), { solver: getAddress(log.solver), allowed: log.allowed });
  return [...latest.entries()]
    .filter(([key, entry]) => entry.allowed && key !== lc(ANY_SOLVER))
    .map(([, entry]) => entry.solver)
    .sort((a, b) => (lc(a) < lc(b) ? -1 : lc(a) > lc(b) ? 1 : 0));
}
