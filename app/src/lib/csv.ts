// CSV export of a member's invoices and clearing history (RFC 4180, CRLF line endings).
import type { CycleDetail, Invoice } from "../../../core/state.ts";
import { statusLabel } from "../../../core/state.ts";
import { isoDate, refToText } from "./format.ts";
import { toDecimalString, type TokenSymbol } from "./money.ts";

export type CsvValue = string | number | bigint;

/** Quotes a field when it contains a delimiter, a quote or a line break. */
export function csvField(value: CsvValue): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Free text from the chain (names, memos, references) is written by other people. A leading =, +, -, @ or control
 * character would make spreadsheet apps evaluate it as a formula, so such values get a leading apostrophe.
 */
export function safeText(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

export function toCsv(header: string[], rows: CsvValue[][]): string {
  return [header, ...rows].map((row) => row.map(csvField).join(",")).join("\r\n") + "\r\n";
}

export interface CsvContext {
  me: string;
  nameOf: (address: string) => string;
  symbolOf: (token: string) => TokenSymbol;
}

export function invoicesCsv(invoices: Invoice[], context: CsvContext): string {
  const me = context.me.toLowerCase();
  const mine = invoices.filter((inv) => inv.creditor.toLowerCase() === me || inv.debtor.toLowerCase() === me);
  const rows = mine.map((inv) => {
    const receivable = inv.creditor.toLowerCase() === me;
    const counterparty = receivable ? inv.debtor : inv.creditor;
    return [
      inv.id,
      receivable ? "receivable" : "payable",
      counterparty,
      safeText(context.nameOf(counterparty)),
      context.symbolOf(inv.token),
      toDecimalString(inv.amount),
      toDecimalString(inv.outstanding),
      statusLabel[inv.status],
      isoDate(inv.dueDate),
      isoDate(inv.issuedAt),
      safeText(refToText(inv.ref)),
      safeText(inv.memo),
    ];
  });
  const header = [
    "invoice_id",
    "side",
    "counterparty",
    "counterparty_name",
    "token",
    "amount",
    "outstanding",
    "status",
    "due_utc",
    "issued_utc",
    "reference",
    "memo",
  ];
  return toCsv(header, rows);
}

export interface ClearingEntry {
  cycleId: bigint;
  timestamp: bigint;
  token: string;
  transactionHash: string | null;
  detail: CycleDetail;
}

/** One row per invoice of `me` cleared in a cycle, with the member's net for that cycle. */
export function clearingCsv(entries: ClearingEntry[], invoices: Invoice[], context: CsvContext): string {
  const me = context.me.toLowerCase();
  const byId = new Map(invoices.map((inv) => [inv.id, inv]));
  const rows: CsvValue[][] = [];
  for (const entry of entries) {
    const myNet = entry.detail.nets.find((n) => n.member.toLowerCase() === me)?.net ?? 0n;
    for (const clear of entry.detail.clears) {
      const inv = byId.get(clear.id);
      if (!inv) continue;
      const receivable = inv.creditor.toLowerCase() === me;
      if (!receivable && inv.debtor.toLowerCase() !== me) continue;
      const counterparty = receivable ? inv.debtor : inv.creditor;
      rows.push([
        entry.cycleId,
        isoDate(entry.timestamp),
        context.symbolOf(entry.token),
        clear.id,
        receivable ? "receivable" : "payable",
        counterparty,
        safeText(context.nameOf(counterparty)),
        toDecimalString(clear.amount),
        toDecimalString(clear.remaining),
        toDecimalString(myNet),
        entry.transactionHash ?? "",
      ]);
    }
  }
  const header = [
    "cycle_id",
    "settled_utc",
    "token",
    "invoice_id",
    "side",
    "counterparty",
    "counterparty_name",
    "cleared",
    "remaining",
    "my_cycle_net",
    "transaction",
  ];
  return toCsv(header, rows);
}

/** Starts a browser download of `text` as a CSV file. */
export function downloadCsv(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
