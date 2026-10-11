// Test fixtures: small ChainState values built by hand. Used only by tests, never imported by the app.
import type { Hex } from "../../../core/chains.ts";
import { InvoiceStatus, lc, type ChainState, type Invoice, type Member } from "../../../core/state.ts";

export const USDC: Hex = "0x3600000000000000000000000000000000000000";
export const EURC: Hex = "0x5fbdb2315678afecb367f032d93f642f64180aa3";

/** A distinct, valid address per number: addr(1) = 0x00..0001. */
export function addr(n: number): Hex {
  return `0x${n.toString(16).padStart(40, "0")}`;
}

export interface MemberSpec {
  address: Hex;
  name?: string;
  deposit?: bigint;
  blocked?: boolean;
  allowsAnySolver?: boolean;
  drawableBySubmitter?: boolean;
}

export function member(spec: MemberSpec): Member {
  const allowsAnySolver = spec.allowsAnySolver ?? false;
  return {
    address: spec.address,
    name: spec.name ?? "",
    registered: Boolean(spec.name),
    balances: { [lc(USDC)]: spec.deposit ?? 0n, [lc(EURC)]: 0n },
    blocked: { [lc(USDC)]: spec.blocked ?? false, [lc(EURC)]: spec.blocked ?? false },
    allowsAnySolver,
    drawableBySubmitter: spec.drawableBySubmitter ?? allowsAnySolver,
  };
}

let nextId = 1n;

/** An accepted, due USDC invoice by default. */
export function invoice(debtor: Hex, creditor: Hex, amount: bigint, extra: Partial<Invoice> = {}): Invoice {
  return {
    id: extra.id ?? nextId++,
    creditor,
    debtor,
    token: USDC,
    amount,
    outstanding: amount,
    dueDate: 0n,
    status: InvoiceStatus.Open,
    ref: `0x${"0".repeat(64)}`,
    issuedAt: 0n,
    memo: "",
    ...extra,
  };
}

export function chainState(members: Member[], invoices: Invoice[], submitter: Hex | null = null): ChainState {
  return {
    network: "local",
    clearingHouse: addr(0xc1ea2),
    blockNumber: 100n,
    timestamp: 1_000n,
    tokens: [USDC, EURC],
    members: Object.fromEntries(members.map((m) => [lc(m.address), m])),
    invoices,
    cycles: [],
    totals: [],
    submitter,
  };
}
