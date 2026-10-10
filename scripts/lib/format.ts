// Console formatting: money (bigint only, never floats), addresses, percentages and aligned tables.
import { NATIVE_SCALE } from "../../core/chains.ts";

const UNIT = 1_000_000n; // 6-decimal token units per whole USDC or EURC

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 6-decimal units as a plain decimal: at least `minDecimals`, more only when the amount has sub-cent digits. */
export function decimal(units: bigint, minDecimals = 2): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / UNIT;
  let frac = (abs % UNIT).toString().padStart(6, "0");
  while (frac.length > minDecimals && frac.endsWith("0")) frac = frac.slice(0, -1);
  return `${negative ? "-" : ""}${groupThousands(whole.toString())}${frac ? `.${frac}` : ""}`;
}

/** `$12.40`, `-$0.35`, `$0.004125` (USDC, 6-decimal units). */
export function usd(units: bigint): string {
  return units < 0n ? `-$${decimal(-units)}` : `$${decimal(units)}`;
}

/** `+$0.85`, `-$0.35`, `$0.00`: for net positions. */
export function signedUsd(units: bigint): string {
  if (units === 0n) return "$0.00";
  return units > 0n ? `+${usd(units)}` : usd(units);
}

/** `EUR 12.40` (EURC, 6-decimal units). */
export function eur(units: bigint): string {
  return units < 0n ? `-EUR ${decimal(-units)}` : `EUR ${decimal(units)}`;
}

/** Money in the right currency for a token symbol. */
export function money(units: bigint, symbol: string): string {
  return symbol === "EURC" ? eur(units) : usd(units);
}

/** Native USDC (18 decimals, e.g. a gas cost) rounded half up to 6 decimals: `0.003906 USDC`. */
export function nativeUsdc(wei: bigint, decimals = 6): string {
  const scale = 10n ** BigInt(18 - decimals);
  const rounded = (wei + scale / 2n) / scale;
  const negative = rounded < 0n;
  const abs = negative ? -rounded : rounded;
  const base = 10n ** BigInt(decimals);
  const frac = (abs % base).toString().padStart(decimals, "0");
  return `${negative ? "-" : ""}${groupThousands((abs / base).toString())}.${frac} USDC`;
}

/** Native wei rounded up to whole 6-decimal units (what a USDC ERC-20 transfer or a deposit can carry). */
export function weiToUnitsCeil(wei: bigint): bigint {
  return (wei + NATIVE_SCALE - 1n) / NATIVE_SCALE;
}

export function int(n: bigint | number): string {
  return groupThousands(n.toString());
}

/** `0x1234…abcd` */
export function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** part / whole as a percentage with one decimal, e.g. `99.8%`. */
export function pct(part: bigint, whole: bigint): string {
  if (whole === 0n) return "n/a";
  const tenths = (part * 1000n + whole / 2n) / whole;
  return `${tenths / 10n}.${tenths % 10n}%`;
}

export function date(unixSeconds: bigint): string {
  return new Date(Number(unixSeconds) * 1000).toISOString().slice(0, 10);
}

export function dateTime(unixSeconds: bigint): string {
  return new Date(Number(unixSeconds) * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export type Align = "left" | "right";

/** An aligned text table, indented by two spaces. `align[i]` right-aligns column i (use it for amounts). */
export function table(headers: string[], rows: string[][], align: Align[] = []): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => (align[i] === "right" ? cell.padStart(widths[i]) : cell.padEnd(widths[i])))
      .join("  ")
      .trimEnd();
  const rule = widths.map((w) => "-".repeat(w)).join("  ");
  return ["  " + line(headers), "  " + rule, ...rows.map((r) => "  " + line(r))].join("\n");
}

export function heading(text: string): void {
  console.log(`\n${text}\n${"=".repeat(text.length)}`);
}

export function section(text: string): void {
  console.log(`\n${text}`);
}
