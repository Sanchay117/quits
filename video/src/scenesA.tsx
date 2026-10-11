// Scenes 1 to 5: the loop, Wall Street's netting, the gap, the brand, and the live Arc Mainnet cycle.
import type { ReactNode } from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import '../../app/src/styles/graph.css'
import { GraphCanvas } from '../../app/src/graph/DebtGraph.tsx'
import { DATA, SETTLED, short, usd } from './data'
import { Backdrop, Badge, clamp, Counter, cue, EASE, Panel, Pop, rand, Stamp, useRamp, useSeconds, useShake, useSpringAt } from './kit'
import { C, DISPLAY, GRAPH_TOKENS, MONO, SERIF, SERIF_ITALIC } from './theme'

type P = { voice: number }

// ---------------------------------------------------------------------------------------------------------------
// 1. The loop: four businesses, four $100 debts, paid one by one, then cancelled.
// ---------------------------------------------------------------------------------------------------------------

const LOOP = [
  { name: 'Roaster', x: 960, y: 205 },
  { name: 'Packaging', x: 1350, y: 520 },
  { name: 'Freight', x: 960, y: 835 },
  { name: 'Cafe', x: 570, y: 520 },
]
const CENTER = { x: 960, y: 520 }

function loopCurve(i: number) {
  const a = LOOP[i]
  const b = LOOP[(i + 1) % 4]
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const ox = mx - CENTER.x
  const oy = my - CENTER.y
  const len = Math.hypot(ox, oy)
  const c = { x: mx + (ox / len) * 70, y: my + (oy / len) * 70 }
  const trim = (p: { x: number; y: number }, q: { x: number; y: number }, d: number) => {
    const l = Math.hypot(q.x - p.x, q.y - p.y)
    return { x: p.x + ((q.x - p.x) / l) * d, y: p.y + ((q.y - p.y) / l) * d }
  }
  const s = trim(a, c, 78)
  const e = trim(b, c, 92)
  const at = (t: number) => ({
    x: (1 - t) ** 2 * s.x + 2 * (1 - t) * t * c.x + t ** 2 * e.x,
    y: (1 - t) ** 2 * s.y + 2 * (1 - t) * t * c.y + t ** 2 * e.y,
  })
  return { d: `M${s.x},${s.y} Q${c.x},${c.y} ${e.x},${e.y}`, at, label: at(0.5), end: e, c }
}

export function Hook({ voice }: P) {
  const t = useSeconds()
  const drawAt = [0.18, 0.33, 0.45, 0.55].map((f) => cue(voice, f))
  const payAt = cue(voice, 0.64)
  const payStep = (cue(voice, 0.8) - payAt) / 4
  const cancelAt = cue(voice, 0.84)
  const cancel = useRamp(cancelAt, cancelAt + 0.9)
  const ring = useRamp(cancelAt + 0.1, cancelAt + 1.4)
  const shake = useShake(cancelAt + 0.05, 10)
  const paidCount = Math.max(0, Math.min(4, Math.floor((t - payAt) / payStep)))

  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill style={{ transform: `translate(${shake.x}px, ${shake.y}px)` }}>
        <svg width={1920} height={1080}>
          <defs>
            <marker id="hook-head" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill={cancel > 0.3 ? C.lime : C.edge} />
            </marker>
          </defs>
          {LOOP.map((_, i) => {
            const curve = loopCurve(i)
            const draw = interpolate(t, [drawAt[i], drawAt[i] + 0.7], [0, 1], { ...clamp, easing: EASE })
            const color = cancel > 0.2 ? C.lime : C.edge
            const glow = cancel > 0.2 ? `drop-shadow(0 0 14px ${C.glow})` : 'none'
            return (
              <g key={i} opacity={1 - cancel * 0.85}>
                <path
                  d={curve.d}
                  pathLength={1}
                  fill="none"
                  stroke={color}
                  strokeWidth={9}
                  strokeLinecap="round"
                  strokeDasharray="1 1"
                  strokeDashoffset={1 - draw}
                  markerEnd={draw > 0.95 ? 'url(#hook-head)' : undefined}
                  style={{ filter: glow }}
                />
                <text
                  x={curve.label.x}
                  y={curve.label.y}
                  textAnchor="middle"
                  dy="0.35em"
                  fill={C.ink}
                  fontFamily={SERIF}
                  fontSize={46}
                  opacity={interpolate(draw, [0.5, 1], [0, 1], clamp)}
                  style={{ paintOrder: 'stroke', stroke: C.bg, strokeWidth: 10 }}
                >
                  $100
                </text>
              </g>
            )
          })}
          {/* Paid one by one: a coin runs each debt in turn. */}
          {LOOP.map((_, i) => {
            const k = (t - payAt - i * payStep) / payStep
            if (k < 0 || k > 1 || cancel > 0) return null
            const p = loopCurve(i).at(k)
            return <circle key={i} cx={p.x} cy={p.y} r={17} fill={C.lime} style={{ filter: `drop-shadow(0 0 16px ${C.glow})` }} />
          })}
          {/* The cancel: a lime shockwave from the centre. */}
          {ring > 0 && ring < 1 && (
            <circle cx={CENTER.x} cy={CENTER.y} r={80 + ring * 620} fill="none" stroke={C.lime} strokeWidth={8 * (1 - ring)} opacity={1 - ring} />
          )}
          {LOOP.map((n, i) => {
            const s = interpolate(t, [0.2 + i * 0.15, 0.75 + i * 0.15], [0, 1], { ...clamp, easing: EASE })
            return (
              <g key={n.name} transform={`translate(${n.x},${n.y}) scale(${s})`}>
                <circle r={66} fill={C.surface} stroke={cancel > 0.2 ? C.lime : C.lineStrong} strokeWidth={5} />
                <text textAnchor="middle" dy="0.35em" fill={C.ink} fontFamily={DISPLAY} fontWeight={800} fontSize={28}>
                  {n.name}
                </text>
              </g>
            )
          })}
        </svg>
        {/* The tally in the middle: $400 paid one by one, then $0. */}
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 30 }}>
          <div style={{ textAlign: 'center', opacity: interpolate(t, [payAt - 0.2, payAt + 0.2], [0, 1], clamp) }}>
            <div style={{ fontFamily: SERIF, fontSize: 150, lineHeight: 1, color: cancel > 0.4 ? C.lime : C.ink, textShadow: cancel > 0.4 ? `0 0 40px ${C.glow}` : 'none' }}>
              {cancel > 0.4 ? '$0' : `$${paidCount * 100}`}
            </div>
            <div style={{ fontFamily: DISPLAY, fontSize: 30, fontWeight: 700, letterSpacing: '0.12em', color: C.muted, textTransform: 'uppercase' }}>
              {cancel > 0.4 ? 'moves' : 'moved'}
            </div>
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Wall Street: $1.77 trillion of trades crushed to $38 billion.
// ---------------------------------------------------------------------------------------------------------------

export function Dtcc({ voice }: P) {
  const t = useSeconds()
  const grow = useRamp(cue(voice, 0.2), cue(voice, 0.5))
  const crush = useRamp(cue(voice, 0.6), cue(voice, 0.72), EASE)
  const bigAt = cue(voice, 0.76)
  const shake = useShake(cue(voice, 0.6), 12)
  const width = 1520 * grow * (1 - crush * 0.9785)
  return (
    <AbsoluteFill>
      <Backdrop tint="rgba(94, 234, 212, 0.18)" />
      <AbsoluteFill style={{ padding: '120px 200px', transform: `translate(${shake.x}px, ${shake.y}px)` }}>
        <Pop at={0.2}>
          <Badge color={C.mint}>DTCC · NSCC · an average day in 2020</Badge>
        </Pop>
        <Pop at={0.6} style={{ marginTop: 40 }}>
          <div style={{ fontFamily: DISPLAY, fontSize: 64, fontWeight: 800, color: C.ink, lineHeight: 1.05 }}>Wall Street nets its trades.</div>
        </Pop>
        <div style={{ marginTop: 70, fontFamily: SERIF, fontSize: 132, color: C.ink, lineHeight: 1 }}>
          {crush < 0.5 ? (
            <Counter from={0} to={1.77} at={cue(voice, 0.2)} dur={cue(voice, 0.5) - cue(voice, 0.2)} format={(n) => `$${n.toFixed(2)} trillion`} />
          ) : (
            <span style={{ color: C.lime, textShadow: `0 0 30px ${C.glow}` }}>
              <Counter from={1770} to={38} at={cue(voice, 0.6)} dur={0.9} format={(n) => `$${Math.round(n)} billion`} />
            </span>
          )}
        </div>
        <div style={{ marginTop: 40, height: 90, position: 'relative' }}>
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              height: 90,
              width,
              borderRadius: 14,
              background: crush > 0.5 ? C.lime : `repeating-linear-gradient(110deg, ${C.edge} 0 22px, ${C.lineStrong} 22px 44px)`,
              backgroundPositionX: -t * 120,
              boxShadow: crush > 0.5 ? `0 0 40px ${C.glow}` : 'none',
            }}
          />
          {/* Shards of the netted-away value flying off as the bar is crushed. */}
          {crush > 0 &&
            crush < 1 &&
            Array.from({ length: 26 }, (_, i) => {
              const k = crush
              const x = 40 + rand(i) * 1440
              const dy = -120 - rand(i, 2) * 260
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: x,
                    top: 30 + k * dy,
                    width: 26 + rand(i, 3) * 40,
                    height: 12,
                    borderRadius: 4,
                    background: C.edge,
                    opacity: 1 - k,
                    transform: `rotate(${rand(i, 4) * 180 * k}deg)`,
                  }}
                />
              )
            })}
        </div>
        <div style={{ marginTop: 60, display: 'flex', alignItems: 'baseline', gap: 28, opacity: t >= bigAt ? 1 : 0 }}>
          <Pop at={bigAt}>
            <span style={{ fontFamily: SERIF_ITALIC, fontSize: 170, color: C.lime, lineHeight: 0.9, textShadow: `0 0 40px ${C.glow}` }}>98%</span>
          </Pop>
          <Pop at={bigAt + 0.25}>
            <span style={{ fontFamily: DISPLAY, fontSize: 48, fontWeight: 700, color: C.ink2 }}>never had to move.</span>
          </Pop>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// 3. The gap: small businesses pay every invoice in full.
// ---------------------------------------------------------------------------------------------------------------

export function Gap() {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return (
    <AbsoluteFill>
      <Backdrop tint="rgba(251, 113, 133, 0.16)" />
      {Array.from({ length: 18 }, (_, i) => {
        const start = 0.05 + i * 0.12
        const k = interpolate(frame / fps, [start, start + 0.8], [0, 1], { ...clamp, easing: EASE })
        const x = 80 + rand(i) * 1680
        const yEnd = 560 + rand(i, 1) * 360
        const rot = (rand(i, 2) - 0.5) * 40
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x,
              top: -260 + k * (yEnd + 260),
              width: 230,
              padding: '18px 20px',
              borderRadius: 14,
              background: '#e9eee2',
              color: '#1b2118',
              transform: `rotate(${rot * k}deg)`,
              boxShadow: '0 18px 40px rgba(0,0,0,0.45)',
              fontFamily: MONO,
              fontSize: 17,
              opacity: k > 0 ? 1 : 0,
            }}
          >
            <div style={{ fontWeight: 700 }}>INVOICE #{1040 + i}</div>
            <div style={{ marginTop: 6, color: '#4b5546' }}>${(40 + rand(i, 5) * 160).toFixed(2)}</div>
            <div
              style={{
                marginTop: 10,
                display: 'inline-block',
                padding: '2px 8px',
                border: `3px solid ${C.rose}`,
                color: C.rose,
                borderRadius: 6,
                fontFamily: DISPLAY,
                fontWeight: 800,
                fontSize: 16,
                letterSpacing: '0.1em',
                transform: 'rotate(-6deg)',
              }}
            >
              PAID IN FULL
            </div>
          </div>
        )
      })}
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'flex-start', paddingTop: 200, zIndex: 5 }}>
        <Pop at={0.15}>
          <div style={{ fontFamily: DISPLAY, fontSize: 92, fontWeight: 800, color: C.ink, textAlign: 'center', lineHeight: 1.02, textShadow: '0 10px 40px rgba(0,0,0,0.8)' }}>
            Small businesses
            <br />
            still pay <span style={{ color: C.rose }}>in full.</span>
          </div>
        </Pop>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Brand: the Q ring draws itself, the wordmark rises.
// ---------------------------------------------------------------------------------------------------------------

export function Brand() {
  const t = useSeconds()
  const ring = useRamp(0.1, 1.0)
  const flash = interpolate(t, [0.9, 1.1, 1.6], [0, 1, 0], clamp)
  const letters = 'Quits'.split('')
  return (
    <AbsoluteFill>
      <Backdrop intensity={1.6} />
      <AbsoluteFill style={{ background: C.lime, opacity: flash * 0.12 }} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 34 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
          <svg width={190} height={190} viewBox="0 0 26 26" style={{ filter: `drop-shadow(0 0 24px ${C.glow})` }}>
            <circle cx="12" cy="12" r="8.5" fill="none" stroke={C.ink} strokeWidth="3.2" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - ring} />
            <path d="M16.5 16.5 L23 23" stroke={C.ink} strokeWidth="3.2" strokeLinecap="round" opacity={ring > 0.95 ? 1 : 0} />
            <circle cx="12" cy="12" r={2.6 * useSpringAt(0.9)} fill={C.lime} />
          </svg>
          <div style={{ display: 'flex' }}>
            {letters.map((ch, i) => (
              <Pop key={i} at={0.35 + i * 0.07} y={60}>
                <span style={{ fontFamily: DISPLAY, fontSize: 210, fontWeight: 800, color: C.ink, letterSpacing: '-0.02em', lineHeight: 1 }}>{ch}</span>
              </Pop>
            ))}
          </div>
        </div>
        <Pop at={1.0}>
          <div style={{ fontFamily: DISPLAY, fontSize: 46, fontWeight: 600, color: C.ink2 }}>
            A clearing house for invoices, <span style={{ color: C.lime }}>on Arc.</span>
          </div>
        </Pop>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// 5. Live: the real cycle on Arc Mainnet, rendered by the app's own graph, collapsing to five transfers.
// ---------------------------------------------------------------------------------------------------------------

export function Live({ voice }: P) {
  const t = useSeconds()
  const clearFrom = cue(voice, 0.5)
  const clearTo = cue(voice, 0.86)
  const clear = interpolate(t, [clearFrom, clearTo], [0, 1], clamp)
  const settle = interpolate(t, [clearTo + 0.15, clearTo + 1.5], [0, 1], clamp)
  const stampAt = clearTo + 1.6
  const shake = useShake(stampAt + 0.08, 16)
  const zoom = interpolate(t, [0, cue(voice, 1) + 2], [1, 1.05])
  const owed = SETTLED.edges.reduce((s, e) => s + e.amount, 0n)
  const gross = Number(SETTLED.gross) / 1e6
  const cash = Number(SETTLED.cash) / 1e6

  const stat = (label: string, value: ReactNode, at: number, color: string = C.ink) => (
    <Pop at={at}>
      <div style={{ padding: '22px 26px', borderRadius: 20, background: 'rgba(16,21,17,0.86)', border: `1px solid ${C.lineStrong}` }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 700, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{label}</div>
        <div style={{ fontFamily: SERIF, fontSize: 64, color, lineHeight: 1.05 }}>{value}</div>
      </div>
    </Pop>
  )

  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill style={{ padding: '70px 80px', transform: `translate(${shake.x}px, ${shake.y}px)` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Pop at={0.1}>
            <Badge>Live · Arc Mainnet · cycle #0</Badge>
          </Pop>
          <Pop at={0.4}>
            <span style={{ fontFamily: MONO, fontSize: 24, color: C.muted }}>
              settle() tx <span style={{ color: C.ink2 }}>{short(DATA.tx.settle)}</span>
            </span>
          </Pop>
        </div>
        <div style={{ display: 'flex', gap: 40, marginTop: 30 }}>
          <Pop at={0.25} style={{ flex: 'none' }}>
            <Panel style={{ width: 1210, height: 800, overflow: 'hidden', position: 'relative', fontFamily: DISPLAY, ...GRAPH_TOKENS }}>
              <div style={{ transform: `scale(${zoom})`, transformOrigin: '50% 50%' }}>
                <GraphCanvas model={SETTLED} clear={clear} settle={settle} ariaLabel="cycle" width={1210} height={800} clock={t} labels="auto" />
              </div>
              <div style={{ position: 'absolute', right: 40, top: 40 }}>
                <Stamp at={stampAt} note="99.8% netted" size={0.9} />
              </div>
            </Panel>
          </Pop>
          <div style={{ display: 'grid', gap: 22, alignContent: 'start', width: 470 }}>
            {stat('Companies', DATA.companies, 0.5)}
            {stat('Invoices', SETTLED.edges.length, 0.7)}
            {stat('Owed', usd(owed), 0.9)}
            {stat('Cleared', <Counter from={0} to={gross} at={clearFrom} dur={clearTo - clearFrom} format={(n) => `$${n.toFixed(2)}`} />, clearFrom - 0.2, C.lime)}
            {stat('Cash moved', <Counter from={0} to={cash} at={clearTo + 0.15} dur={1.3} format={(n) => `$${n.toFixed(2)}`} />, clearTo, C.mint)}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
