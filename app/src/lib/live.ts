// Views of the live chain state for the graph and the tables.
import { InvoiceStatus, lc, type ChainState, type Invoice } from "../../../core/state.ts";
import type { EdgeTone } from "../graph/model.ts";
import { displayName } from "./format.ts";
import type { Debt, Party } from "./netting.ts";

export function nameResolver(state: ChainState | null): (address: string) => string {
  return (address) => displayName(address, state?.members[lc(address)]?.name);
}

export function partiesFromState(state: ChainState, token: string): Party[] {
  const key = lc(token);
  return Object.entries(state.members).map(([id, member]) => ({
    id,
    name: displayName(member.address, member.name),
    deposit: member.balances[key] ?? 0n,
    blocked: member.blocked[key] ?? false,
  }));
}

function toneOf(invoice: Invoice, now: bigint): EdgeTone {
  if (invoice.status === InvoiceStatus.Pending) return "pending";
  return invoice.dueDate > now ? "waiting" : "debt";
}

/** Invoices still in play for `token`: pending ones and accepted ones with something outstanding. */
export function liveInvoices(state: ChainState, token: string): Invoice[] {
  const key = lc(token);
  return state.invoices.filter(
    (inv) =>
      lc(inv.token) === key &&
      (inv.status === InvoiceStatus.Pending || (inv.status === InvoiceStatus.Open && inv.outstanding > 0n)),
  );
}

export function debtsFromState(state: ChainState, token: string): Debt[] {
  return liveInvoices(state, token).map((inv) => ({
    id: inv.id,
    debtor: lc(inv.debtor),
    creditor: lc(inv.creditor),
    amount: inv.outstanding,
    memo: inv.memo,
    tone: toneOf(inv, state.timestamp),
  }));
}

export interface Position {
  receivable: bigint;
  payable: bigint;
}

/** What each member is owed and owes on accepted invoices of `token`. */
export function openPositions(state: ChainState, token: string): Map<string, Position> {
  const positions = new Map<string, Position>();
  const get = (id: string) => positions.get(id) ?? { receivable: 0n, payable: 0n };
  for (const inv of liveInvoices(state, token)) {
    if (inv.status !== InvoiceStatus.Open) continue;
    const creditor = get(lc(inv.creditor));
    positions.set(lc(inv.creditor), { ...creditor, receivable: creditor.receivable + inv.outstanding });
    const debtor = get(lc(inv.debtor));
    positions.set(lc(inv.debtor), { ...debtor, payable: debtor.payable + inv.outstanding });
  }
  return positions;
}
