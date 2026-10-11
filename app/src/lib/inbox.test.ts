import { describe, expect, it } from "vitest";
import { InvoiceStatus, type Invoice } from "../../../core/state.ts";
import { arrivedSince, idList, recheckShown, skippedText, totalsText, type FreshInvoice } from "./inbox.ts";
import { addr, EURC, invoice } from "./testState.ts";

const me = addr(0x5e);
const creditor = addr(0xc0);
const USD = (dollars: number) => BigInt(Math.round(dollars * 1_000_000));

const pending = (id: number, amount = USD(10), extra: Partial<Invoice> = {}) =>
  invoice(me, creditor, amount, { id: BigInt(id), status: InvoiceStatus.Pending, ...extra });

const asRead = (inv: Invoice, change: Partial<FreshInvoice> = {}): FreshInvoice => ({
  creditor: inv.creditor,
  debtor: inv.debtor,
  token: inv.token,
  amount: inv.amount,
  dueDate: inv.dueDate,
  status: inv.status,
  ...change,
});

describe("recheckShown", () => {
  it("keeps invoices that still read back as pending, for this account, unchanged", () => {
    const shown = [pending(3), pending(5)];
    const fresh = new Map(shown.map((inv) => [inv.id, asRead(inv)]));
    expect(recheckShown(shown, fresh, me.toUpperCase().replace("0X", "0x"))).toEqual({ ids: [3n, 5n], skipped: [] });
  });

  it("skips anything that changed since the member saw it, with a reason", () => {
    const shown = [pending(6), pending(1), pending(2), pending(3), pending(4), pending(5), pending(7)];
    const [six, one, two, three, four, five] = shown;
    const fresh = new Map<bigint, FreshInvoice>([
      [1n, asRead(one)],
      [2n, asRead(two, { status: InvoiceStatus.Cancelled })],
      [3n, asRead(three, { status: InvoiceStatus.Open })],
      [4n, asRead(four, { debtor: addr(0x99) })],
      [5n, asRead(five, { amount: USD(11) })],
      [6n, asRead(six, { status: InvoiceStatus.Rejected })],
      // 7 could not be read back at all
    ]);
    const { ids, skipped } = recheckShown(shown, fresh, me);
    expect(ids).toEqual([1n]);
    expect(skipped).toEqual([
      { id: 2n, reason: "cancelled by the creditor" },
      { id: 3n, reason: "already accepted" },
      { id: 4n, reason: "it is addressed to another account" },
      { id: 5n, reason: "it differs from what you were shown" },
      { id: 6n, reason: "already rejected" },
      { id: 7n, reason: "it could not be read back" },
    ]);
  });

  it("never accepts an id twice or one it was not shown", () => {
    const one = pending(1);
    const fresh = new Map<bigint, FreshInvoice>([
      [1n, asRead(one)],
      [2n, asRead(pending(2))],
    ]);
    expect(recheckShown([one, one], fresh, me)).toEqual({ ids: [1n], skipped: [] });
  });

  it("checks token and due date too", () => {
    const shown = [pending(1), pending(2)];
    const fresh = new Map<bigint, FreshInvoice>([
      [1n, asRead(shown[0], { token: EURC })],
      [2n, asRead(shown[1], { dueDate: 99n })],
    ]);
    expect(recheckShown(shown, fresh, me).ids).toEqual([]);
  });
});

describe("text helpers", () => {
  it("lists ids in plain English", () => {
    expect(idList([])).toBe("");
    expect(idList([3n])).toBe("#3");
    expect(idList([3n, 5n])).toBe("#3 and #5");
    expect(idList([3n, 5n, 7n])).toBe("#3, #5 and #7");
  });

  it("totals per token, USDC first", () => {
    const symbolOf = (token: string) => (token === EURC ? "EURC" : "USDC") as "USDC" | "EURC";
    const euro = pending(2, USD(3), { token: EURC });
    expect(totalsText([pending(1, USD(12.4))], symbolOf)).toBe("$12.40");
    expect(totalsText([euro, pending(1, USD(12.4)), pending(3, USD(0.6))], symbolOf)).toBe("$13.00 and €3.00");
    expect(totalsText([], symbolOf)).toBe("");
  });

  it("points out invoices that arrived after the click", () => {
    const confirmed = [pending(1), pending(2)];
    expect(arrivedSince(confirmed, [pending(2), pending(4), pending(9)])).toEqual([4n, 9n]);
    expect(arrivedSince(confirmed, confirmed)).toEqual([]);
  });

  it("summarises skipped invoices", () => {
    expect(skippedText([])).toBe("");
    expect(
      skippedText([
        { id: 2n, reason: "cancelled by the creditor" },
        { id: 4n, reason: "already accepted" },
      ]),
    ).toBe("Skipped #2 (cancelled by the creditor), #4 (already accepted).");
  });

  it("uses no en or em dashes", () => {
    const all = [idList([1n, 2n, 3n]), skippedText([{ id: 1n, reason: "already paid" }])].join(" ");
    expect(all).not.toMatch(/[–—]/);
  });
});
