// The live Arc Mainnet snapshot written by scripts/video-snapshot.ts, with bigints revived.
import raw from './data.json'
import type { GraphModel } from '../../app/src/graph/model.ts'

function revive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(revive)
  if (value && typeof value === 'object') {
    if ('$n' in value && Object.keys(value).length === 1) return BigInt((value as { $n: string }).$n)
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, revive(v)]))
  }
  return value
}

const data = revive(raw) as {
  contract: string
  explorer: string
  companies: number
  invoiceCount: number
  totals: { cleared: bigint; cash: bigint }
  tx: { deploy: string; fund: string; memo: string; settle: string }
  settled: GraphModel
  open: GraphModel
}

export const DATA = data
export const SETTLED = data.settled
export const OPEN = data.open

/** 6-decimal units as dollars with cents, e.g. 74655000n -> "$74.66". */
export function usd(units: bigint, decimals = 2): string {
  return `$${(Number(units) / 1e6).toFixed(decimals)}`
}

export function short(hex: string): string {
  return `${hex.slice(0, 6)}…${hex.slice(-4)}`
}
