// The built-in sample network shown on Home until a real cycle exists on chain. These are simulated companies of our
// own, not customers, and every screen that shows them says so. They carry the names of the seven demo companies the
// scripts seed on chain (scripts/lib/demo.ts), so the simulation and the live network tell one story.
import { keccak256, stringToHex } from "viem";
import { UNITS_PER_TOKEN } from "./money.ts";
import type { Debt, Party } from "./netting.ts";

/** Deterministic stand-in address for a simulated company (never used on chain). */
export function simulatedAddress(name: string): string {
  return keccak256(stringToHex(`quits-simulated:${name}`)).slice(0, 42);
}

const cents = (value: number) => (BigInt(value) * UNITS_PER_TOKEN) / 100n;

export const COMPANIES = {
  freight: "Kestrel Freight",
  packaging: "Boxwell Packaging",
  roaster: "Ember Hill Roasters",
  cafes: "Fernway Cafes",
  studio: "Halftone Studio",
  print: "Inkline Print Shop",
  dairy: "Meadowgate Dairy",
} as const;

type Company = keyof typeof COMPANIES;

/** Deposits in cents: small next to the invoices, enough for each member's net position. */
const DEPOSITS: Record<Company, number> = {
  freight: 200,
  packaging: 300,
  roaster: 250,
  cafes: 1000,
  studio: 400,
  print: 1000,
  dairy: 600,
};

/** debtor, creditor, cents, memo. Mostly loops, as real supply chains are. */
const INVOICES: [Company, Company, number, string][] = [
  ["cafes", "roaster", 6400, "Espresso beans, October"],
  ["roaster", "packaging", 4650, "Compostable coffee bags"],
  ["packaging", "freight", 3800, "Pallet deliveries"],
  ["freight", "cafes", 3960, "Driver lunches, Q3"],
  ["cafes", "print", 2400, "Seasonal menus"],
  ["print", "studio", 2700, "Menu template design"],
  ["studio", "cafes", 1860, "Client meeting tab"],
  ["roaster", "freight", 2900, "Green bean haulage"],
  ["dairy", "packaging", 3380, "Milk carton supply"],
  ["cafes", "dairy", 3800, "Oat and dairy milk"],
  ["freight", "print", 4000, "Waybill printing"],
  ["studio", "roaster", 1200, "Office coffee subscription"],
  ["packaging", "studio", 2400, "Box artwork"],
  ["print", "packaging", 1940, "Card stock"],
  ["dairy", "freight", 2100, "Cold chain runs"],
  ["packaging", "cafes", 3400, "Staff catering"],
  ["print", "cafes", 2600, "Launch event catering"],
  ["studio", "dairy", 1200, "Office milk delivery"],
];

export interface SampleNetwork {
  parties: Party[];
  debts: Debt[];
}

export function sampleNetwork(): SampleNetwork {
  const address = (company: Company) => simulatedAddress(COMPANIES[company]);
  const parties = (Object.keys(COMPANIES) as Company[]).map((company) => ({
    id: address(company),
    name: COMPANIES[company],
    deposit: cents(DEPOSITS[company]),
  }));
  const debts = INVOICES.map(([debtor, creditor, amount, memo], i) => ({
    id: BigInt(i + 1),
    debtor: address(debtor),
    creditor: address(creditor),
    amount: cents(amount),
    memo,
  }));
  return { parties, debts };
}
