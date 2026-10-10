// "Accept all": accept exactly the invoices the member was shown, re-checked against the chain right before sending.
import { InvoiceStatus, lc, type Invoice } from "../../../core/state.ts";
import { formatMoney, type TokenSymbol } from "./money.ts";

/** The parts of an invoice read back from the chain (getInvoice) to re-check it. */
export type FreshInvoice = Pick<Invoice, "creditor" | "debtor" | "token" | "amount" | "dueDate" | "status">;

export interface Skipped {
  id: bigint;
  reason: string;
}

export interface Recheck {
  /** Ids still waiting for this account exactly as shown, ascending. */
  ids: bigint[];
  skipped: Skipped[];
}

const NOT_PENDING: Record<number, string> = {
  [InvoiceStatus.None]: "it does not exist",
  [InvoiceStatus.Open]: "already accepted",
  [InvoiceStatus.Paid]: "already paid",
  [InvoiceStatus.Rejected]: "already rejected",
  [InvoiceStatus.Cancelled]: "cancelled by the creditor",
};

/**
 * Which of the shown invoices may still be accepted: each must read back from the chain as Pending, addressed to
 * `account`, and with the creditor, token, amount and due date the member saw. Anything else is skipped with a reason.
 */
export function recheckShown(shown: Invoice[], fresh: Map<bigint, FreshInvoice>, account: string): Recheck {
  const ids: bigint[] = [];
  const skipped: Skipped[] = [];
  const seen = new Set<bigint>();
  for (const invoice of [...shown].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (seen.has(invoice.id)) continue;
    seen.add(invoice.id);
    const now = fresh.get(invoice.id);
    const reason = !now
      ? "it could not be read back"
      : now.status !== InvoiceStatus.Pending
        ? (NOT_PENDING[now.status] ?? "it is no longer pending")
        : lc(now.debtor) !== lc(account)
          ? "it is addressed to another account"
          : lc(now.creditor) !== lc(invoice.creditor) ||
              lc(now.token) !== lc(invoice.token) ||
              now.amount !== invoice.amount ||
              now.dueDate !== invoice.dueDate
            ? "it differs from what you were shown"
            : null;
    if (reason) skipped.push({ id: invoice.id, reason });
    else ids.push(invoice.id);
  }
  return { ids, skipped };
}

/** "#3", "#3 and #5", "#3, #5 and #7". */
export function idList(ids: bigint[]): string {
  const tags = ids.map((id) => `#${id}`);
  if (tags.length <= 1) return tags.join("");
  return `${tags.slice(0, -1).join(", ")} and ${tags[tags.length - 1]}`;
}

/** Per-token totals in a stable order (USDC first): "$12.40 and €3.00". */
export function totalsText(invoices: Invoice[], symbolOf: (token: string) => TokenSymbol): string {
  const totals = new Map<TokenSymbol, bigint>();
  for (const invoice of invoices) {
    const symbol = symbolOf(invoice.token);
    totals.set(symbol, (totals.get(symbol) ?? 0n) + invoice.amount);
  }
  const order: TokenSymbol[] = ["USDC", "EURC"];
  const parts = order.filter((s) => totals.has(s)).map((s) => formatMoney(totals.get(s)!, s));
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Ids in the inbox now that were not in the list the member confirmed. */
export function arrivedSince(confirmed: Invoice[], inbox: Invoice[]): bigint[] {
  const known = new Set(confirmed.map((inv) => inv.id));
  return inbox.filter((inv) => !known.has(inv.id)).map((inv) => inv.id);
}

/** "Skipped #5 (cancelled by the creditor)." or "" when nothing was skipped. */
export function skippedText(skipped: Skipped[]): string {
  if (skipped.length === 0) return "";
  return `Skipped ${skipped.map((s) => `#${s.id} (${s.reason})`).join(", ")}.`;
}
