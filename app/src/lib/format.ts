// Display helpers for addresses, names, dates and invoice references.
import { bytesToString, hexToBytes, stringToHex, type Hex } from "viem";

/** "0x1234…abcd" */
export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/** The registered name when there is one, otherwise the short address. */
export function displayName(address: string, name?: string | null): string {
  return name && name.trim() ? name : shortAddress(address);
}

/** Up to two initials for a node label: "Ember Roasters" -> "ER", "0x12ab…" -> "12". */
export function initials(label: string): string {
  if (label.startsWith("0x")) return label.slice(2, 4).toUpperCase();
  const words = label.split(/\s+/).filter((word) => /[A-Za-z0-9]/.test(word));
  return words
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");
}

const dateFormat = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDate(unixSeconds: bigint): string {
  return dateFormat.format(new Date(Number(unixSeconds) * 1000));
}

export function formatDateTime(unixSeconds: bigint): string {
  return dateTimeFormat.format(new Date(Number(unixSeconds) * 1000));
}

/** ISO 8601 in UTC, or "" for 0 (used for "due immediately"). */
export function isoDate(unixSeconds: bigint): string {
  return unixSeconds === 0n ? "" : new Date(Number(unixSeconds) * 1000).toISOString();
}

const ZERO_REF = `0x${"0".repeat(64)}`;

/** Encodes a short text reference (e.g. an invoice number) as bytes32. Null if it does not fit in 32 bytes. */
export function textToRef(text: string): Hex | null {
  const trimmed = text.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) return trimmed as Hex;
  if (new TextEncoder().encode(trimmed).length > 32) return null;
  return stringToHex(trimmed, { size: 32 });
}

/** Reads a bytes32 reference back as text when it is printable, otherwise as a short hex string. */
export function refToText(ref: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(ref) || ref.toLowerCase() === ZERO_REF) return "";
  const bytes = hexToBytes(ref as Hex);
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  const text = bytesToString(bytes.slice(0, end));
  const printable = !text.includes("�") && !/[\u0000-\u001f\u007f]/.test(text);
  return printable ? text : shortAddress(ref);
}

/** Byte length of a string once UTF-8 encoded: the contract's limits (names, memos) are in bytes. */
export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}
