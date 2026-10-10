// Random invoice networks for the Playground. Seeded, so a network can be regenerated exactly.
import { simulatedAddress } from "./demo.ts";
import { UNITS_PER_TOKEN } from "./money.ts";
import type { Debt, Party } from "./netting.ts";

/** mulberry32: a tiny, fast, seedable PRNG returning floats in [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

const NAMES = [
  "Tidewater Freight",
  "Boxwell Packaging",
  "Ember Roasters",
  "Juniper Cafes",
  "Studio Meridian",
  "Halftone Print",
  "Greenleaf Dairy",
  "Copperline Electric",
  "Fernhill Bakery",
  "Lumen Signs",
  "Harbor Linen",
  "Kestrel Couriers",
  "Oakum Joinery",
  "Pinecone Media",
  "Mosaic Tiles",
  "Riverbend Farms",
];

export const LIMITS = {
  companies: { min: 3, max: 12 },
  invoices: { min: 3, max: 60 },
  liquidityPercent: { min: 0, max: 100 },
} as const;

export interface RandomNetworkOptions {
  companies: number;
  invoices: number;
  /** Each company's deposit as a percentage of what it owes in total. */
  liquidityPercent: number;
  seed: number;
}

export interface RandomNetwork {
  parties: Party[];
  debts: Debt[];
}

const MIN_CENTS = 500;
const MAX_CENTS = 9500;

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function randomPair(count: number, random: () => number): [number, number] {
  const debtor = Math.floor(random() * count);
  const creditor = (debtor + 1 + Math.floor(random() * (count - 1))) % count;
  return [debtor, creditor];
}

/** Invoices of $5 to $95 between random pairs; deposits are a share of each company's payables, rounded to cents. */
export function randomNetwork(options: RandomNetworkOptions): RandomNetwork {
  const random = seededRandom(options.seed);
  const names = shuffled(NAMES, random).slice(0, options.companies);
  const ids = names.map((name) => simulatedAddress(name));

  const payables = new Array<bigint>(names.length).fill(0n);
  const debts: Debt[] = [];
  for (let i = 0; i < options.invoices; i++) {
    const [debtor, creditor] = randomPair(names.length, random);
    const cents = BigInt(MIN_CENTS + Math.floor(random() * (MAX_CENTS - MIN_CENTS + 1)));
    const amount = (cents * UNITS_PER_TOKEN) / 100n;
    payables[debtor] += amount;
    debts.push({ id: BigInt(i + 1), debtor: ids[debtor], creditor: ids[creditor], amount });
  }

  const percent = BigInt(Math.round(options.liquidityPercent));
  const centUnits = UNITS_PER_TOKEN / 100n;
  const parties = names.map((name, i) => ({
    id: ids[i],
    name,
    deposit: ((payables[i] * percent) / 100n / centUnits) * centUnits,
  }));
  return { parties, debts };
}
