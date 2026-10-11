// Scenes 6 to 10: how it works, why Arc, solver consent, proof, and the outro.
import type { ReactNode } from 'react'
import { AbsoluteFill, interpolate } from 'remotion'
import '../../app/src/styles/graph.css'
import { GraphCanvas } from '../../app/src/graph/DebtGraph.tsx'
import { DATA, OPEN, short, usd } from './data'
import { Backdrop, Badge, clamp, Counter, cue, EASE, Panel, Pop, Stamp, Typewriter, useRamp, useSeconds, useShake, useSpringAt } from './kit'
import { C, DISPLAY, GRAPH_TOKENS, MONO, SERIF } from './theme'

type P = { voice: number }

function Title({ at, children }: { at: number; children: ReactNode }) {
  return (
    <Pop at={at}>
      <div style={{ fontFamily: DISPLAY, fontSize: 68, fontWeight: 800, color: C.ink, lineHeight: 1.05 }}>{children}</div>
    </Pop>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// 6. How it works: issue, accept, deposit, net, settle.
// ---------------------------------------------------------------------------------------------------------------

function Step({ n, title, at, children }: { n: number; title: string; at: number; children: ReactNode }) {
  const t = useSeconds()
  const on = useSpringAt(at)
  const active = t >= at
  return (
    <div style={{ width: 318, opacity: 0.35 + 0.65 * on, transform: `translateY(${(1 - on) * 30}px)` }}>
      <div
        style={{
          height: 300,
          borderRadius: 24,
          background: 'rgba(16,21,17,0.9)',
          border: `2px solid ${active ? C.lime : C.lineStrong}`,
          boxShadow: active ? `0 0 40px ${C.glow}` : 'none',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {children}
      </div>
      <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ fontFamily: MONO, fontSize: 22, color: active ? C.lime : C.muted }}>0{n}</span>
        <span style={{ fontFamily: DISPLAY, fontSize: 38, fontWeight: 800, color: C.ink }}>{title}</span>
      </div>
    </div>
  )
}

function MiniInvoice({ stampAt }: { stampAt?: number }) {
  return (
    <div style={{ position: 'absolute', inset: 34, borderRadius: 14, background: '#e9eee2', color: '#1b2118', padding: 20, fontFamily: MONO, fontSize: 19 }}>
      <div style={{ fontWeight: 700 }}>INV-1042</div>
      <div style={{ color: '#4b5546', marginTop: 6 }}>Freight, Oct week 2</div>
      <div style={{ fontFamily: SERIF, fontSize: 52, marginTop: 14 }}>$4.26</div>
      <div style={{ color: '#4b5546' }}>Kestrel → Ember Hill</div>
      {stampAt !== undefined && (
        <div style={{ position: 'absolute', right: 10, bottom: 18 }}>
          <Stamp at={stampAt} word="Accepted" size={0.34} color="#4a7a0c" rotate={-12} />
        </div>
      )}
    </div>
  )
}

export function How({ voice }: P) {
  const t = useSeconds()
  const cues = [0.03, 0.18, 0.3, 0.45, 0.68].map((f) => cue(voice, f))
  const coin = interpolate(t, [cues[2], cues[2] + 0.8], [0, 1], { ...clamp, easing: EASE })
  const net = interpolate(t, [cues[3] + 0.2, cues[4] - 0.2], [0, 1], clamp)
  const settle = interpolate(t, [cues[4] - 0.2, cues[4] + 0.8], [0, 1], clamp)
  const lineK = interpolate(t, [cues[0], cues[4] + 0.4], [0, 1], { ...clamp, easing: EASE })
  const checksAt = cue(voice, 0.82)
  const checks = ['accepted and due', 'never above outstanding', 'deposit covers the net', 'not on the blocklist', 'payer consented']
  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill style={{ padding: '90px 110px' }}>
        <Title at={0.1}>How Quits works</Title>
        <div style={{ position: 'relative', marginTop: 70, display: 'flex', justifyContent: 'space-between' }}>
          <div style={{ position: 'absolute', left: 150, right: 150, top: 150, height: 4, background: C.lineStrong }} />
          <div style={{ position: 'absolute', left: 150, top: 150, height: 4, width: `calc((100% - 300px) * ${lineK})`, background: C.lime, boxShadow: `0 0 16px ${C.glow}` }} />
          <Step n={1} title="Issue" at={cues[0]}>
            <Pop at={cues[0] + 0.15} y={60}>
              <div style={{ position: 'relative', height: 300 }}>
                <MiniInvoice />
              </div>
            </Pop>
          </Step>
          <Step n={2} title="Accept" at={cues[1]}>
            <MiniInvoice stampAt={cues[1] + 0.3} />
          </Step>
          <Step n={3} title="Deposit" at={cues[2]}>
            <svg width={318} height={300}>
              <circle cx={159} cy={180} r={70} fill="none" stroke={C.lineStrong} strokeWidth={14} />
              <circle
                cx={159}
                cy={180}
                r={70}
                fill="none"
                stroke={C.lime}
                strokeWidth={14}
                pathLength={1}
                strokeDasharray="1 1"
                strokeDashoffset={1 - coin * 0.72}
                transform="rotate(-90 159 180)"
                style={{ filter: `drop-shadow(0 0 10px ${C.glow})` }}
              />
              <circle cx={159} cy={40 + coin * 140} r={20} fill={C.lime} opacity={1 - coin} />
              <text x={159} y={186} textAnchor="middle" fill={C.ink} fontFamily={SERIF} fontSize={40}>
                USDC
              </text>
            </svg>
          </Step>
          <Step n={4} title="Net" at={cues[3]}>
            <div style={{ ...GRAPH_TOKENS, fontFamily: DISPLAY }}>
              <GraphCanvas model={OPEN} clear={net} settle={net >= 1 ? 1 : 0} ariaLabel="net" width={318} height={300} clock={t} />
            </div>
          </Step>
          <Step n={5} title="Settle" at={cues[4]}>
            <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 14 }}>
              <div style={{ fontFamily: SERIF, fontSize: 78, color: C.lime, opacity: settle }}>1 tx</div>
              <div style={{ fontFamily: DISPLAY, fontSize: 28, fontWeight: 700, color: C.ink2, opacity: settle }}>
                all or nothing
                <br />
                final in &lt; 1 s
              </div>
            </AbsoluteFill>
          </Step>
        </div>
        <div style={{ marginTop: 56, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {checks.map((c, i) => (
            <Pop key={c} at={checksAt + i * 0.16} y={16}>
              <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center', padding: '12px 20px', borderRadius: 999, border: `1px solid ${C.lineStrong}`, background: 'rgba(16,21,17,0.86)', fontFamily: DISPLAY, fontSize: 26, fontWeight: 600, color: C.ink }}>
                <span style={{ color: C.lime, fontWeight: 800 }}>✓</span>
                {c}
              </span>
            </Pop>
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// 7. Why Arc: six tiles, each lighting up as the voice reaches it.
// ---------------------------------------------------------------------------------------------------------------

function Tile({ at, title, foot, children }: { at: number; title: string; foot: string; children: ReactNode }) {
  const t = useSeconds()
  const lit = t >= at
  return (
    <Pop at={at} y={40}>
      <div
        style={{
          height: 372,
          borderRadius: 26,
          padding: 30,
          background: 'rgba(16,21,17,0.9)',
          border: `2px solid ${lit ? C.lime : C.lineStrong}`,
          boxShadow: lit ? `0 0 46px rgba(190,242,70,0.22)` : 'none',
          display: 'grid',
          gridTemplateRows: 'auto 1fr auto',
          gap: 12,
        }}
      >
        <div style={{ fontFamily: DISPLAY, fontSize: 36, fontWeight: 800, color: C.ink }}>{title}</div>
        <div style={{ position: 'relative', overflow: 'hidden' }}>{children}</div>
        <div style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 600, color: C.muted }}>{foot}</div>
      </div>
    </Pop>
  )
}

function Code({ children }: { children: ReactNode }) {
  return <div style={{ fontFamily: MONO, fontSize: 24, color: C.ink2, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 12, padding: '14px 16px' }}>{children}</div>
}

export function ArcScene({ voice }: P) {
  const t = useSeconds()
  const at = [0.07, 0.3, 0.5, 0.63, 0.75, 0.86].map((f) => cue(voice, f))
  const strike = useRamp(at[0] + 1.2, at[0] + 1.6)
  const block = useRamp(at[1] + 0.3, at[1] + 0.9)
  const merge = useRamp(at[4] + 0.3, at[4] + 1.3)
  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill style={{ padding: '70px 90px' }}>
        <Title at={0.1}>
          Why <span style={{ color: C.lime }}>Arc</span>
        </Title>
        <div style={{ marginTop: 36, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 28 }}>
          <Tile at={at[0]} title="USDC is the native coin" foot="A deposit is one transaction, no approval">
            <Code>
              <Typewriter text="deposit{ value: 0.05 USDC }()" at={at[0] + 0.3} cps={30} />
            </Code>
            <div style={{ marginTop: 22, position: 'relative', display: 'inline-block', fontFamily: MONO, fontSize: 26, color: C.muted }}>
              token.approve(house, amount)
              <div style={{ position: 'absolute', left: 0, top: '52%', height: 4, width: `${strike * 100}%`, background: C.rose }} />
            </div>
          </Tile>
          <Tile at={at[1]} title="Final in under a second" foot="Deterministic finality: no reorgs, no waiting">
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 30 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ width: 92, height: 92, borderRadius: 14, background: C.surface2, border: `2px solid ${C.lineStrong}` }} />
              ))}
              <div
                style={{
                  width: 92,
                  height: 92,
                  borderRadius: 14,
                  background: C.limeSoft,
                  border: `2px solid ${C.lime}`,
                  transform: `translateX(${(1 - block) * 160}px)`,
                  opacity: block,
                  display: 'grid',
                  placeItems: 'center',
                  color: C.lime,
                  fontSize: 52,
                  fontWeight: 800,
                  fontFamily: DISPLAY,
                  boxShadow: `0 0 26px ${C.glow}`,
                }}
              >
                ✓
              </div>
            </div>
            <div style={{ marginTop: 24, fontFamily: SERIF, fontSize: 56, color: C.lime }}>
              <Counter from={0} to={0.48} at={at[1] + 0.3} dur={0.6} format={(n) => `${n.toFixed(2)} s`} />
            </div>
          </Tile>
          <Tile at={at[2]} title="Sanctions in the rules" foot="settle() and withdraw() check Circle's blocklist">
            <Code>isBlacklisted(member)</Code>
            <svg width={420} height={150} style={{ marginTop: 10 }}>
              <path d="M70,20 L120,38 L120,80 C120,110 95,128 70,138 C45,128 20,110 20,80 L20,38 Z" fill={C.limeSoft} stroke={C.lime} strokeWidth={4} />
              <text x={70} y={92} textAnchor="middle" fill={C.lime} fontSize={44} fontWeight={800} fontFamily={DISPLAY}>
                ✓
              </text>
              <circle cx={300} cy={80} r={44} fill={C.surface2} stroke={C.rose} strokeWidth={5} opacity={useRamp(at[2] + 0.5, at[2] + 0.9)} />
              <path d="M280,60 L320,100 M320,60 L280,100" stroke={C.rose} strokeWidth={7} strokeLinecap="round" opacity={useRamp(at[2] + 0.8, at[2] + 1.1)} />
            </svg>
          </Tile>
          <Tile at={at[3]} title="Arc Memo" foot="Invoice references, indexed on chain">
            <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 26 }}>
              <div style={{ padding: '18px 22px', borderRadius: 14, background: '#e9eee2', color: '#1b2118', fontFamily: MONO, fontSize: 24, fontWeight: 700, transform: `rotate(${-4 + useRamp(at[3], at[3] + 0.6) * 4}deg)` }}>
                memoId: INV-1042
              </div>
            </div>
            <div style={{ marginTop: 26, fontFamily: MONO, fontSize: 22, color: C.muted }}>
              tx <span style={{ color: C.ink2 }}>{short(DATA.tx.memo)}</span>
            </div>
          </Tile>
          <Tile at={at[4]} title="Multicall3From" foot="A company's calls in one transaction, each as the sender">
            <div style={{ position: 'relative', height: 200 }}>
              {['register', 'setSolver', 'issue', 'issue', 'issue'].map((name, i) => {
                const y0 = 8 + i * 38
                return (
                  <div
                    key={i}
                    style={{
                      position: 'absolute',
                      left: 0 + merge * 150,
                      top: y0 + (80 - y0) * merge,
                      padding: '6px 14px',
                      borderRadius: 999,
                      background: C.surface2,
                      border: `1px solid ${C.lineStrong}`,
                      fontFamily: MONO,
                      fontSize: 20,
                      color: C.ink2,
                      opacity: 1 - merge * 0.9,
                    }}
                  >
                    {name}()
                  </div>
                )
              })}
              <div
                style={{
                  position: 'absolute',
                  left: 150,
                  top: 70,
                  padding: '12px 24px',
                  borderRadius: 999,
                  background: C.limeSoft,
                  border: `2px solid ${C.lime}`,
                  fontFamily: DISPLAY,
                  fontSize: 30,
                  fontWeight: 800,
                  color: C.lime,
                  opacity: merge,
                  transform: `scale(${0.7 + 0.3 * merge})`,
                }}
              >
                1 transaction
              </div>
            </div>
          </Tile>
          <Tile at={at[5]} title="About a cent a cycle" foot="Gas is priced in USDC: settling 20 invoices">
            <div style={{ fontFamily: SERIF, fontSize: 120, color: C.lime, lineHeight: 1, marginTop: 18, textShadow: `0 0 30px ${C.glow}` }}>
              <Counter from={1} to={0.012} at={at[5] + 0.2} dur={1.2} format={(n) => `$${n.toFixed(n < 0.1 ? 3 : 2)}`} />
            </div>
            <div style={{ marginTop: 10, fontFamily: MONO, fontSize: 22, color: C.muted }}>~611,000 gas at 20 gwei</div>
          </Tile>
        </div>
        <div style={{ opacity: t > 0 ? 1 : 0 }} />
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// 8. Consent: a cherry-pick attempt reverts; the full loop clears for anyone.
// ---------------------------------------------------------------------------------------------------------------

export function Consent({ voice }: P) {
  const t = useSeconds()
  const grabAt = cue(voice, 0.12)
  const revertAt = cue(voice, 0.36)
  const codeAt = cue(voice, 0.42)
  const loopAt = cue(voice, 0.8)
  const lift = interpolate(t, [grabAt, grabAt + 0.6, revertAt, revertAt + 0.3], [0, 1, 1, 0], clamp)
  const shake = useShake(revertAt, 18)
  const cancel = useRamp(loopAt, loopAt + 0.8)
  const top = { d: 'M600,420 Q960,250 1320,420', label: { x: 960, y: 320 } }
  const bottom = { d: 'M1320,560 Q960,730 600,560', label: { x: 960, y: 660 } }
  const color = (base: string) => (cancel > 0.2 ? C.lime : base)
  return (
    <AbsoluteFill>
      <Backdrop tint={t > revertAt && t < loopAt ? 'rgba(251,113,133,0.2)' : C.glow} />
      <AbsoluteFill style={{ padding: '80px 100px' }}>
        <Title at={0.1}>No cherry-picking</Title>
      </AbsoluteFill>
      <AbsoluteFill style={{ transform: `translate(${shake.x}px, ${shake.y}px)` }}>
        <svg width={1920} height={1080}>
          <defs>
            <marker id="cons-head" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill={color(C.edge)} />
            </marker>
          </defs>
          <g transform={`translate(0, ${-lift * 40})`} opacity={1 - cancel * 0.85}>
            <path d={top.d} fill="none" stroke={lift > 0.1 && cancel === 0 ? C.rose : color(C.edge)} strokeWidth={10} markerEnd="url(#cons-head)" style={{ filter: lift > 0.1 ? 'drop-shadow(0 0 16px rgba(251,113,133,0.6))' : 'none' }} />
            <text x={top.label.x} y={top.label.y} textAnchor="middle" fill={C.ink} fontFamily={SERIF} fontSize={52} style={{ paintOrder: 'stroke', stroke: C.bg, strokeWidth: 10 }}>
              $50
            </text>
          </g>
          <g opacity={1 - cancel * 0.85}>
            <path d={bottom.d} fill="none" stroke={color(C.edge)} strokeWidth={10} markerEnd="url(#cons-head)" />
            <text x={bottom.label.x} y={bottom.label.y} textAnchor="middle" fill={C.ink} fontFamily={SERIF} fontSize={52} style={{ paintOrder: 'stroke', stroke: C.bg, strokeWidth: 10 }}>
              $50
            </text>
          </g>
          {[
            { x: 520, name: 'Roaster', sub: 'has a deposit' },
            { x: 1400, name: 'Packaging', sub: 'tries to collect' },
          ].map((n) => (
            <g key={n.name} transform={`translate(${n.x},490)`}>
              <circle r={84} fill={C.surface} stroke={cancel > 0.2 ? C.lime : C.lineStrong} strokeWidth={6} />
              <text textAnchor="middle" dy="0.35em" fill={C.ink} fontFamily={DISPLAY} fontWeight={800} fontSize={32}>
                {n.name}
              </text>
              <text textAnchor="middle" y={130} fill={C.muted} fontFamily={DISPLAY} fontWeight={600} fontSize={24}>
                {n.sub}
              </text>
            </g>
          ))}
        </svg>
        {t >= revertAt && t < loopAt && (
          <AbsoluteFill style={{ alignItems: 'center', paddingTop: 190 }}>
            <Pop at={revertAt} y={-20}>
              <div style={{ padding: '14px 28px', borderRadius: 16, background: 'rgba(46,17,25,0.92)', border: `3px solid ${C.rose}`, color: C.rose, fontFamily: MONO, fontSize: 34, fontWeight: 700 }}>
                ✕ reverted: PayerNotConsenting(Roaster)
              </div>
            </Pop>
          </AbsoluteFill>
        )}
        {t >= codeAt && t < loopAt && (
          <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 190 }}>
            <Panel style={{ padding: '20px 28px' }}>
              <Typewriter text="if (!_mayDraw(member, msg.sender)) revert PayerNotConsenting(member);" at={codeAt} cps={46} style={{ fontSize: 28, color: C.ink2 }} />
            </Panel>
          </AbsoluteFill>
        )}
        {t >= loopAt && (
          <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
            <Pop at={loopAt + 0.3}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontFamily: SERIF, fontSize: 150, color: C.lime, lineHeight: 1, textShadow: `0 0 40px ${C.glow}` }}>$0</div>
                <div style={{ fontFamily: DISPLAY, fontSize: 34, fontWeight: 700, color: C.ink2 }}>the full loop clears, for anyone</div>
              </div>
            </Pop>
          </AbsoluteFill>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// 9. Proof: the real mainnet run, typed out, beside the trust facts.
// ---------------------------------------------------------------------------------------------------------------

export function Proof({ voice }: P) {
  const lines = [
    { text: '$ scripts/mainnet-demo.sh', color: C.muted },
    { text: `deploy   ClearingHouse ${short(DATA.contract)}     tx ${short(DATA.tx.deploy)}`, color: C.ink2 },
    { text: `fund     7 companies, 1 Multicall3From tx  tx ${short(DATA.tx.fund)}`, color: C.ink2 },
    { text: `memo     INV-1042 through Arc Memo         tx ${short(DATA.tx.memo)}`, color: C.ink2 },
    { text: `settle   20 invoices: ${usd(SETTLED_GROSS)} cleared, ${usd(SETTLED_CASH)} moved`, color: C.lime },
    { text: `         tx ${short(DATA.tx.settle)}  final`, color: C.lime },
  ]
  const facts = [
    { at: cue(voice, 0.02), big: 'No owner', small: 'no admin, no upgrades, no fees' },
    { at: cue(voice, 0.24), big: '176 tests', small: 'unit, fuzz and 7 stateful invariants' },
    { at: cue(voice, 0.64), big: 'Verified', small: 'Sourcify ✓   Arc Explorer ✓' },
  ]
  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill style={{ padding: '80px 90px', flexDirection: 'row', gap: 50 }}>
        <Pop at={0.1} style={{ flex: 'none' }}>
          <Panel style={{ width: 1080, padding: '0 0 30px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', gap: 10, padding: '18px 22px', borderBottom: `1px solid ${C.line}` }}>
              {[C.rose, C.amber, C.lime].map((c) => (
                <span key={c} style={{ width: 16, height: 16, borderRadius: 99, background: c, opacity: 0.8 }} />
              ))}
              <span style={{ marginLeft: 14, fontFamily: MONO, fontSize: 20, color: C.muted }}>Arc Mainnet · chain 5042</span>
            </div>
            <div style={{ padding: '24px 30px', display: 'grid', gap: 16 }}>
              {lines.map((l, i) => (
                <Typewriter key={i} text={l.text} at={0.3 + i * 0.95} cps={70} style={{ fontSize: 26, color: l.color }} />
              ))}
            </div>
          </Panel>
          <div style={{ marginTop: 30, fontFamily: MONO, fontSize: 26, color: C.muted }}>
            explorer.arc.io/address/<span style={{ color: C.ink2 }}>{DATA.contract}</span>
          </div>
        </Pop>
        <div style={{ display: 'grid', gap: 26, alignContent: 'start', flex: 1 }}>
          {facts.map((f) => (
            <Pop key={f.big} at={f.at} y={40}>
              <div style={{ padding: '26px 30px', borderRadius: 24, border: `2px solid ${C.lineStrong}`, background: 'rgba(16,21,17,0.9)' }}>
                <div style={{ fontFamily: SERIF, fontSize: 84, color: C.lime, lineHeight: 1 }}>{f.big}</div>
                <div style={{ marginTop: 8, fontFamily: DISPLAY, fontSize: 28, fontWeight: 600, color: C.ink2 }}>{f.small}</div>
              </div>
            </Pop>
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

const SETTLED_GROSS = DATA.settled.gross
const SETTLED_CASH = DATA.settled.cash

// ---------------------------------------------------------------------------------------------------------------
// 10. Outro.
// ---------------------------------------------------------------------------------------------------------------

export function Outro() {
  const t = useSeconds()
  const ring = useRamp(0.05, 0.9)
  const pulse = interpolate(t % 2.2, [0, 2.2], [0, 1])
  return (
    <AbsoluteFill>
      <Backdrop intensity={1.5} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 30 }}>
        <svg width={220} height={220} viewBox="0 0 26 26" style={{ filter: `drop-shadow(0 0 30px ${C.glow})`, overflow: 'visible' }}>
          <circle cx="12" cy="12" r={8.5 + pulse * 6} fill="none" stroke={C.lime} strokeWidth={0.6} opacity={1 - pulse} />
          <circle cx="12" cy="12" r="8.5" fill="none" stroke={C.ink} strokeWidth="3.2" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - ring} />
          <path d="M16.5 16.5 L23 23" stroke={C.ink} strokeWidth="3.2" strokeLinecap="round" opacity={ring > 0.95 ? 1 : 0} />
          <circle cx="12" cy="12" r="2.6" fill={C.lime} />
        </svg>
        <Pop at={0.4}>
          <div style={{ fontFamily: DISPLAY, fontSize: 104, fontWeight: 800, color: C.ink, textAlign: 'center', lineHeight: 1.02 }}>
            Call it quits on
            <br />
            <span style={{ color: C.lime }}>circular debt.</span>
          </div>
        </Pop>
        <Pop at={1.1}>
          <div style={{ fontFamily: MONO, fontSize: 36, color: C.ink2 }}>sanchay117.github.io/quits</div>
        </Pop>
        <Pop at={1.5}>
          <Badge>Live on Arc Mainnet · {short(DATA.contract)}</Badge>
        </Pop>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
