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

/**
 * Who may send cycles that draw on a member's deposit, as the members table shows it. "you" is the connected
 * wallet's own row: it can always settle its own cycles, so "approved only" would undersell it.
 */
export type SolverAccess = "anyone" | "you" | "approved-you" | "approved-only";

export function solverAccess(member: Member, submitter: string | null): SolverAccess {
  if (member.allowsAnySolver) return "anyone";
  if (submitter !== null && sameAccount(member.address, submitter)) return "you";
  return member.drawableBySubmitter ? "approved-you" : "approved-only";
}

export const SOLVER_ACCESS_LABEL: Record<SolverAccess, string> = {
  anyone: "Anyone",
  you: "You",
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

/**
 * The addresses whose approval by `me` is worth reading (isSolverFor(me, address)) to list the solvers it approved:
 * every member and invoice counterparty, every account that has sent a cycle, and `extra` (an address typed into the
 * form, solvers approved during this visit). Leaves out `me`, the zero address (the switch shows it) and anything
 * that is not an address. Checksummed, each once, sorted by address so the read is stable from poll to poll.
 *
 * This replaces a scan of SolverSet events, which Arc's public RPCs refuse once the deployment is more than 10,000
 * blocks (about 80 minutes) old. The cost: a solver that is none of these is not listed, but the form still checks it.
 */
export function approvalCandidates(state: ChainState, me: string, extra: Iterable<string | null | undefined> = []): Hex[] {
  const found = new Map<string, Hex>();
  const add = (value: string | null | undefined) => {
    if (!value || !isAddress(value, { strict: false })) return;
    const key = lc(value);
    if (key === lc(me) || key === lc(ANY_SOLVER) || found.has(key)) return;
    found.set(key, getAddress(value));
  };
  Object.values(state.members).forEach((m) => add(m.address));
  state.cycles.forEach((cycle) => add(cycle.solver));
  for (const value of extra) add(value);
  return [...found.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, address]) => address);
}

/** The candidates whose isSolverFor(me, candidate) read true, in candidate order. */
export function approvedSolvers(candidates: readonly Hex[], flags: readonly boolean[]): Hex[] {
  if (flags.length !== candidates.length) throw new Error("One approval flag per candidate is required.");
  return candidates.filter((_, i) => flags[i]);
}
