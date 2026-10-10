// Money is bigint in 6-decimal token units everywhere. These helpers only ever do integer arithmetic.

export type TokenSymbol = "USDC" | "EURC";

export const UNITS_PER_TOKEN = 1_000_000n;
const UNITS_PER_CENT = 10_000n;
const DECIMALS = 6;

const SYMBOL_PREFIX: Record<TokenSymbol, string> = { USDC: "$", EURC: "€" };

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function groupThousands(whole: bigint): string {
  return whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Rounds to whole cents, half away from zero. */
function toCents(units: bigint): bigint {
  return (abs(units) + UNITS_PER_CENT / 2n) / UNITS_PER_CENT;
}

/** "1,234.56" for 1_234_560_000n. Rounds to cents; the sign is not included. */
export function formatAmount(units: bigint): string {
  const cents = toCents(units);
  const fraction = (cents % 100n).toString().padStart(2, "0");
  return `${groupThousands(cents / 100n)}.${fraction}`;
}

/** Every significant digit, at least two decimals and no grouping: "12.40", "0.000123". For CSV and inputs. */
export function toDecimalString(units: bigint): string {
  const sign = units < 0n ? "-" : "";
  const value = abs(units);
  const whole = value / UNITS_PER_TOKEN;
  const fraction = (value % UNITS_PER_TOKEN).toString().padStart(DECIMALS, "0").replace(/0{1,4}$/, "");
  return `${sign}${whole}.${fraction.padEnd(2, "0")}`;
}

export interface MoneyOptions {
  /** Prefix positive values with "+". */
  sign?: boolean;
  /** Show every significant digit instead of rounding to cents. */
  precise?: boolean;
}

/** "$12.40", "€12.40", "-$3.10". Nonzero amounts under half a cent read "<$0.01" unless `precise`. */
export function formatMoney(units: bigint, symbol: TokenSymbol = "USDC", options: MoneyOptions = {}): string {
  const prefix = SYMBOL_PREFIX[symbol];
  const sign = units < 0n ? "-" : options.sign && units > 0n ? "+" : "";
  if (options.precise) return `${sign}${prefix}${toDecimalString(abs(units))}`;
  if (units !== 0n && toCents(units) === 0n) return `${sign}<${prefix}0.01`;
  return `${sign}${prefix}${formatAmount(units)}`;
}

/** Parses user input such as "12", "12.4" or "1,250.50" into units. Returns null for anything else. */
export function parseAmount(text: string): bigint | null {
  const cleaned = text.trim().replace(/,/g, "");
  const match = /^(\d*)(?:\.(\d{0,6}))?$/.exec(cleaned);
  if (!match || !/\d/.test(cleaned)) return null;
  const whole = BigInt(match[1] || "0");
  const fraction = BigInt((match[2] ?? "").padEnd(DECIMALS, "0"));
  return whole * UNITS_PER_TOKEN + fraction;
}

/** `part / whole` as a percentage string with `decimals` places, rounded half up: "96.2%". */
export function formatPercent(part: bigint, whole: bigint, decimals = 1): string {
  if (whole <= 0n) return "0%";
  const scale = 10n ** BigInt(decimals);
  const scaled = (part * 100n * scale * 2n + whole) / (whole * 2n);
  const integer = scaled / scale;
  if (decimals === 0) return `${integer}%`;
  return `${integer}.${(scaled % scale).toString().padStart(decimals, "0")}%`;
}

/** Share of the gross that netting removed from the payment flow: (gross - cash) / gross. */
export function nettedAway(gross: bigint, cash: bigint, decimals = 1): string {
  return formatPercent(gross - cash, gross, decimals);
}

/** Scales a bigint by an animation fraction in [0, 1] without leaving integer arithmetic for the money. */
export function scaleByFraction(units: bigint, fraction: number): bigint {
  if (fraction <= 0) return 0n;
  if (fraction >= 1) return units;
  return (units * BigInt(Math.round(fraction * 10_000))) / 10_000n;
}
