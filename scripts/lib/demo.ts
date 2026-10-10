// The demo network: seven small businesses around a coffee supply chain that invoice each other. It is built so that
// netting is dramatic: almost every debt sits on a loop, so a cycle clears hundreds of dollars of invoices while each
// company keeps only cents to a dollar on deposit.
//
// Round 1 (21 invoices, $793.15) is mostly loops plus one open-ended bill (the print shop's grand opening banners for
// the cafes) that the cafes' small deposit cannot cover: the first cycle clears $746.55 with $1.50 of cash and leaves
// the rest open. Round 2 (7 invoices, $244.20) adds the next week's trade, including the cafes catering the print
// shop's launch event, which closes that loop: the second cycle clears everything left, $290.80, with $1.80 of cash.
// Every amount and deposit scales with --scale.
import { hexToString, parseUnits, stringToHex, type Hex } from "viem";
import { fail } from "./args.ts";

export interface DemoCompany {
  name: string;
  /** What the business does, for wallets.ts output. */
  trade: string;
}

/** Wallet order: issue order on chain follows it, which keeps invoice ids stable between runs. */
export const DEMO_COMPANIES: DemoCompany[] = [
  { name: "Kestrel Freight", trade: "freight and cold-chain delivery" },
  { name: "Boxwell Packaging", trade: "bags, boxes, cups and crates" },
  { name: "Ember Hill Roasters", trade: "coffee roaster" },
  { name: "Fernway Cafes", trade: "cafe chain, also caters" },
  { name: "Meadowgate Dairy", trade: "milk for the cafes" },
  { name: "Halftone Studio", trade: "design studio" },
  { name: "Inkline Print Shop", trade: "print shop" },
];

const K = "Kestrel Freight";
const B = "Boxwell Packaging";
const E = "Ember Hill Roasters";
const F = "Fernway Cafes";
const M = "Meadowgate Dairy";
const H = "Halftone Studio";
const I = "Inkline Print Shop";

export interface DemoInvoice {
  round: number;
  creditor: string;
  debtor: string;
  /** Dollars as a decimal string, before --scale. */
  amount: string;
  ref: string;
  memo: string;
}

const inv = (round: number, creditor: string, debtor: string, amount: string, ref: string, memo: string): DemoInvoice => ({
  round,
  creditor,
  debtor,
  amount,
  ref,
  memo,
});

/** Grouped by creditor in wallet order. The first one is issued through Arc's Memo predeploy. */
export const DEMO_INVOICES: DemoInvoice[] = [
  inv(1, K, E, "42.60", "INV-1042", "Freight, Oct week 1: green coffee from the port"),
  inv(1, K, B, "28.80", "INV-1043", "Freight, Oct week 2: flat-pack boxes"),
  inv(1, K, M, "37.20", "INV-1044", "Cold-chain delivery, Oct week 1"),
  inv(1, B, E, "22.50", "BX-2207", "Coffee bags, 500 count"),
  inv(1, B, M, "26.40", "BX-2208", "Milk crates, 24"),
  inv(1, B, F, "17.55", "BX-2209", "Takeaway cups, 1,000"),
  inv(1, E, F, "75.40", "EH-0318", "Espresso blend, 12 kg"),
  inv(1, E, K, "22.50", "EH-0319", "Depot coffee subscription, Oct"),
  inv(1, E, H, "18.40", "EH-0320", "Studio coffee subscription, Oct"),
  inv(1, F, K, "85.25", "FC-5521", "Driver breakfast account, Sept"),
  inv(1, F, H, "62.55", "FC-5522", "Client meeting catering, 3 events"),
  inv(1, F, I, "58.20", "FC-5523", "Office coffee and pastries, Q3"),
  inv(1, M, F, "47.30", "MD-1190", "Milk, Oct week 1"),
  inv(1, M, F, "47.90", "MD-1191", "Milk, Oct week 2"),
  inv(1, H, E, "26.00", "HS-0087", "Label redesign, winter blend"),
  inv(1, H, B, "38.00", "HS-0088", "Box artwork, holiday run"),
  inv(1, H, M, "32.00", "HS-0089", "Carton label design"),
  inv(1, I, F, "18.40", "IP-7730", "Autumn menus, 200 prints"),
  inv(1, I, E, "24.60", "IP-7731", "Bag labels, 1,000"),
  inv(1, I, H, "14.80", "IP-7732", "Proof prints, client deck"),
  inv(1, I, F, "46.80", "IP-7733", "Grand opening banners"),

  inv(2, K, E, "41.20", "INV-1051", "Freight, Oct week 3"),
  inv(2, E, F, "41.60", "EH-0327", "Espresso blend, Oct week 3"),
  inv(2, F, I, "47.30", "FC-5530", "Catering, banner launch event"),
  inv(2, F, K, "41.00", "FC-5531", "Driver breakfast account, Oct"),
  inv(2, F, H, "24.10", "FC-5532", "Studio coffee and pastries, Oct"),
  inv(2, M, F, "24.70", "MD-1198", "Milk, Oct week 3"),
  inv(2, H, M, "24.30", "HS-0094", "Seasonal carton artwork"),
];

/**
 * Deposit each company keeps for a round (dollars, before --scale). Seeding a round tops the deposit up to this level;
 * it never withdraws. Companies missing from a round's table deposit nothing that round.
 */
export const DEMO_DEPOSITS: Record<number, Record<string, string>> = {
  1: { [K]: "0.20", [B]: "0.50", [E]: "0.20", [F]: "0.75", [M]: "0.50", [H]: "0.20", [I]: "0.60" },
  2: { [F]: "0.50", [I]: "1.50" },
};

export const DEMO_ROUNDS = [1, 2];

const MICRO = 1_000_000n;

/** --scale as a multiplier in millionths (1 = 1_000_000n). Positive decimals only, parsed without floats. */
export function parseScale(value: string | undefined): bigint {
  const raw = value ?? "1";
  if (!/^\d+(\.\d{1,6})?$/.test(raw)) fail(`--scale must be a positive decimal like 1, 0.5 or 2.5, got "${raw}"`);
  const scale = parseUnits(raw, 6);
  if (scale === 0n) fail("--scale must be greater than 0");
  return scale;
}

/** A dollar string scaled to 6-decimal units, rounded down (but never below 1 unit). */
export function scaledAmount(amount: string, scale: bigint): bigint {
  const units = (parseUnits(amount, 6) * scale) / MICRO;
  return units > 0n ? units : 1n;
}

/** A deposit scaled to 6-decimal units, rounded up so it still covers its scaled net payment. */
export function scaledDeposit(amount: string, scale: bigint): bigint {
  return (parseUnits(amount, 6) * scale + MICRO - 1n) / MICRO;
}

export function demoRound(round: number): DemoInvoice[] {
  if (!DEMO_ROUNDS.includes(round)) fail(`--round must be one of ${DEMO_ROUNDS.join(", ")}`);
  return DEMO_INVOICES.filter((i) => i.round === round);
}

/** A reference as the contract's bytes32 (UTF-8, right-padded), the same encoding Arc's Memo uses for memo ids. */
export function refToBytes32(ref: string): Hex {
  return stringToHex(ref, { size: 32 });
}

/** A bytes32 reference back to text, or the hex when it is not readable text. */
export function refToText(ref: Hex): string {
  let hex = ref.slice(2);
  while (hex.endsWith("00")) hex = hex.slice(0, -2); // strip whole zero bytes of right padding
  if (hex === "") return "";
  const text = hexToString(`0x${hex}`);
  return /^[\x20-\x7e]+$/.test(text) ? text : ref;
}
