import { stringToHex, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { InvoiceStatus, type Invoice } from "../../../core/state.ts";
import { clearingCsv, csvField, invoicesCsv, safeText, toCsv, type CsvContext } from "./csv.ts";

const ME = "0x00000000000000000000000000000000000000aa" as Hex;
const BOB = "0x00000000000000000000000000000000000000bb" as Hex;
const CAROL = "0x00000000000000000000000000000000000000cc" as Hex;
const USDC = "0x3600000000000000000000000000000000000000" as Hex;

function invoice(overrides: Partial<Invoice>): Invoice {
  return {
    id: 1n,
    creditor: ME,
    debtor: BOB,
    token: USDC,
    amount: 12_400_000n,
    outstanding: 12_400_000n,
    dueDate: 0n,
    status: InvoiceStatus.Open,
    ref: stringToHex("INV-1", { size: 32 }),
    issuedAt: 1_760_000_000n,
    memo: "Beans",
    ...overrides,
  };
}

const context: CsvContext = {
  me: ME,
  nameOf: (address) => ({ [BOB]: "Bob's Bakery", [CAROL]: "=HYPERLINK(\"x\")" })[address] ?? address,
  symbolOf: () => "USDC",
};

const rows = (csv: string) => csv.trimEnd().split("\r\n");

describe("csv fields", () => {
  it("quotes only when needed and doubles inner quotes", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("two\nlines")).toBe('"two\nlines"');
    expect(csvField(12n)).toBe("12");
  });

  it("neutralises spreadsheet formulas in free text", () => {
    expect(safeText("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(safeText("+1")).toBe("'+1");
    expect(safeText("-1")).toBe("'-1");
    expect(safeText("@cmd")).toBe("'@cmd");
    expect(safeText("Beans, October")).toBe("Beans, October");
  });

  it("joins rows with CRLF and ends with a line break", () => {
    expect(toCsv(["a", "b"], [["1", "x,y"]])).toBe('a,b\r\n1,"x,y"\r\n');
  });
});

describe("invoicesCsv", () => {
  it("lists only my invoices, from my side, with exact amounts", () => {
    const csv = invoicesCsv(
      [
        invoice({ id: 1n }),
        invoice({ id: 2n, creditor: BOB, debtor: ME, amount: 5_000_001n, outstanding: 1n, status: InvoiceStatus.Pending }),
        invoice({ id: 3n, creditor: BOB, debtor: CAROL }),
      ],
      context,
    );
    const lines = rows(csv);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      "invoice_id,side,counterparty,counterparty_name,token,amount,outstanding,status,due_utc,issued_utc,reference,memo",
    );
    expect(lines[1]).toBe(`1,receivable,${BOB},Bob's Bakery,USDC,12.40,12.40,Open,,2025-10-09T08:53:20.000Z,INV-1,Beans`);
    expect(lines[2]).toContain("2,payable,");
    expect(lines[2]).toContain(",5.000001,0.000001,Pending,");
  });

  it("escapes counterparty names and memos written by others", () => {
    const csv = invoicesCsv([invoice({ debtor: CAROL, memo: "=cmd|' /C calc'!A0" })], context);
    const line = rows(csv)[1];
    expect(line).toContain(`"'=HYPERLINK(""x"")"`);
    expect(line.endsWith("'=cmd|' /C calc'!A0")).toBe(true);
  });
});

describe("clearingCsv", () => {
  it("writes one row per cleared invoice of mine with my net for the cycle", () => {
    const invoices = [invoice({ id: 1n }), invoice({ id: 2n, creditor: BOB, debtor: CAROL })];
    const csv = clearingCsv(
      [
        {
          cycleId: 0n,
          timestamp: 1_760_000_000n,
          token: USDC,
          transactionHash: "0xabc",
          detail: {
            clears: [
              { id: 1n, amount: 12_400_000n, remaining: 0n },
              { id: 2n, amount: 1_000_000n, remaining: 0n },
            ],
            nets: [{ member: ME, net: 12_400_000n }],
            transactionHash: "0xabc",
          },
        },
      ],
      invoices,
      context,
    );
    const lines = rows(csv);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(`0,2025-10-09T08:53:20.000Z,USDC,1,receivable,${BOB},Bob's Bakery,12.40,0.00,12.40,0xabc`);
  });
});
