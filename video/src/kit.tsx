// Shared motion pieces: the living ledger backdrop, spring entrances, rolling counters, the rubber stamp, a
// typewriter and karaoke captions. Every animation is a pure function of the frame, so renders are repeatable.
import type { CSSProperties, ReactNode } from 'react'
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { C, DISPLAY, MONO } from './theme'
import { LEAD } from './timing'

export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
export const EASE = Easing.bezier(0.2, 0.7, 0.2, 1)

/** Current time in seconds within the scene. */
export function useSeconds(): number {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return frame / fps
}

/** 0 to 1 between two moments (seconds), eased. */
export function useRamp(from: number, to: number, easing = EASE): number {
  const t = useSeconds()
  return interpolate(t, [from, to], [0, 1], { ...clamp, easing })
}

/** A spring that starts at `at` seconds. */
export function useSpringAt(at: number, config: { damping?: number; stiffness?: number; mass?: number } = {}): number {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return spring({ frame: frame - Math.round(at * fps), fps, config: { damping: 14, stiffness: 120, mass: 0.8, ...config } })
}

/** A cue at a fraction of the scene's voice clip, in scene seconds. */
export function cue(voice: number, fraction: number): number {
  return LEAD + voice * fraction
}

/** Deterministic pseudo-random in [0, 1) for index-based scatter. */
export function rand(i: number, salt = 0): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** Ink-green ledger: a slowly drifting dot grid, two breathing aurora lights, film grain and a vignette. */
export function Backdrop({ tint = C.glow, intensity = 1 }: { tint?: string; intensity?: number }) {
  const t = useSeconds()
  const drift = (t * 14) % 36
  const ax = 70 + Math.sin(t * 0.35) * 8
  const ay = 30 + Math.cos(t * 0.27) * 6
  const bx = 18 + Math.cos(t * 0.31) * 7
  const by = 78 + Math.sin(t * 0.23) * 5
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: 'hidden' }}>
      <AbsoluteFill
        style={{
          backgroundImage: `radial-gradient(${C.lineStrong} 1.4px, transparent 1.6px)`,
          backgroundSize: '36px 36px',
          backgroundPosition: `${drift}px ${drift * 0.6}px`,
          opacity: 0.55,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(42% 52% at ${ax}% ${ay}%, ${tint}, transparent 70%), radial-gradient(34% 44% at ${bx}% ${by}%, rgba(94, 234, 212, 0.18), transparent 70%)`,
          opacity: 0.55 * intensity,
        }}
      />
      <AbsoluteFill style={{ background: 'radial-gradient(120% 90% at 50% 50%, transparent 55%, rgba(0,0,0,0.65))' }} />
      <Grain />
    </AbsoluteFill>
  )
}

function Grain() {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill style={{ opacity: 0.06, mixBlendMode: 'overlay' }}>
      <svg width="100%" height="100%">
        <filter id={`grain-${frame % 4}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={frame % 4} />
        </filter>
        <rect width="100%" height="100%" filter={`url(#grain-${frame % 4})`} />
      </svg>
    </AbsoluteFill>
  )
}

/** Fades, lifts and scales its children in with a spring at `at` seconds; optionally out again at `out`. */
export function Pop({ at, out, children, y = 28, style }: { at: number; out?: number; children: ReactNode; y?: number; style?: CSSProperties }) {
  const s = useSpringAt(at)
  const t = useSeconds()
  const leave = out === undefined ? 0 : interpolate(t, [out, out + 0.45], [0, 1], { ...clamp, easing: EASE })
  return (
    <div
      style={{
        opacity: s * (1 - leave),
        transform: `translateY(${(1 - s) * y - leave * 18}px) scale(${0.96 + 0.04 * s})`,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

/** A number that rolls from `from` to `to` between two moments, formatted by `format`. */
export function Counter({ from, to, at, dur, format, style }: { from: number; to: number; at: number; dur: number; format: (n: number) => string; style?: CSSProperties }) {
  const k = useRamp(at, at + dur, Easing.bezier(0.16, 1, 0.3, 1))
  return <span style={{ fontVariantNumeric: 'tabular-nums', ...style }}>{format(from + (to - from) * k)}</span>
}

/** Screen shake that kicks at `at` seconds and decays (pixels). */
export function useShake(at: number, power = 14): { x: number; y: number } {
  const t = useSeconds()
  const age = t - at
  if (age < 0 || age > 0.6) return { x: 0, y: 0 }
  const decay = Math.exp(-age * 9) * power
  return { x: Math.sin(age * 90) * decay, y: Math.cos(age * 70) * decay * 0.6 }
}

/** The QUITS rubber stamp: slams down from above with an overshoot, ink-rough edge and a lime glow. */
export function Stamp({ at, word = 'Quits', note, size = 1, color = C.lime, rotate = -9 }: { at: number; word?: string; note?: string; size?: number; color?: string; rotate?: number }) {
  const s = useSpringAt(at, { damping: 9, stiffness: 180, mass: 0.7 })
  const t = useSeconds()
  if (t < at) return null
  const scale = interpolate(s, [0, 1], [2.6, 1])
  return (
    <div
      style={{
        display: 'inline-grid',
        justifyItems: 'center',
        gap: 6 * size,
        padding: `${14 * size}px ${30 * size}px ${16 * size}px`,
        border: `${6 * size}px solid ${color}`,
        borderRadius: 18 * size,
        color,
        background: 'rgba(9, 12, 10, 0.72)',
        boxShadow: `0 0 0 ${2 * size}px rgba(198,242,78,0.25) inset, 0 0 ${60 * size}px ${C.glow}`,
        transform: `rotate(${rotate + (1 - s) * -14}deg) scale(${scale})`,
        opacity: Math.min(1, s * 1.6),
        fontFamily: DISPLAY,
      }}
    >
      <span style={{ fontSize: 76 * size, fontWeight: 800, letterSpacing: '0.16em', lineHeight: 1, textTransform: 'uppercase' }}>{word}</span>
      {note && <span style={{ fontSize: 22 * size, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{note}</span>}
    </div>
  )
}

/** Types `text` out from `at` seconds at `cps` characters per second, with a blinking block cursor. */
export function Typewriter({ text, at, cps = 38, style }: { text: string; at: number; cps?: number; style?: CSSProperties }) {
  const t = useSeconds()
  const shown = Math.max(0, Math.min(text.length, Math.floor((t - at) * cps)))
  const blink = Math.floor(t * 2.4) % 2 === 0
  return (
    <span style={{ fontFamily: MONO, whiteSpace: 'pre', ...style }}>
      {text.slice(0, shown)}
      {t >= at && <span style={{ opacity: shown < text.length || blink ? 1 : 0, color: C.lime }}>▌</span>}
    </span>
  )
}

/** Splits narration into caption chunks: sentences, long ones cut at a comma or colon near the middle. */
function chunks(text: string): string[] {
  const out: string[] = []
  for (const sentence of text.match(/.+?[.!?](?=\s|$)/g) ?? [text]) {
    let rest = sentence.trim()
    while (rest.length > 74) {
      const mid = rest.length / 2
      const cuts = [...rest.matchAll(/[,:] /g)].map((m) => (m.index ?? 0) + 1)
      if (!cuts.length) break
      const cut = cuts.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a))
      out.push(rest.slice(0, cut).trim())
      rest = rest.slice(cut).trim()
    }
    out.push(rest)
  }
  return out
}

/** Karaoke captions: the current chunk, its words lighting up lime as the voice reaches them. */
export function Captions({ text, voice }: { text: string; voice: number }) {
  const t = useSeconds()
  const parts = chunks(text)
  const total = parts.reduce((a, p) => a + p.length, 0)
  let start = LEAD
  const timed = parts.map((p) => {
    const d = (p.length / total) * voice
    const item = { p, from: start, to: start + d }
    start += d
    return item
  })
  const current = timed.find((c) => t >= c.from && t < c.to + 0.25) ?? (t < LEAD ? undefined : timed[timed.length - 1])
  if (!current || t > LEAD + voice + 0.6) return null
  const words = current.p.split(' ')
  const progress = (t - current.from) / (current.to - current.from)
  const lit = Math.floor(progress * words.length * 1.02)
  const enter = interpolate(t, [current.from, current.from + 0.2], [0, 1], clamp)
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 54, pointerEvents: 'none' }}>
      <div
        style={{
          maxWidth: 1500,
          padding: '14px 26px',
          borderRadius: 16,
          background: 'rgba(9, 12, 10, 0.78)',
          border: `1px solid ${C.line}`,
          fontFamily: DISPLAY,
          fontSize: 34,
          fontWeight: 600,
          lineHeight: 1.3,
          textAlign: 'center',
          opacity: enter,
          transform: `translateY(${(1 - enter) * 10}px)`,
        }}
      >
        {words.map((w, i) => (
          <span key={i} style={{ color: i < lit ? C.ink : C.muted, transition: 'none' }}>
            {w}
            {i < words.length - 1 ? ' ' : ''}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  )
}

/** A glassy panel in the site's surface colour. */
export function Panel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        background: 'rgba(16, 21, 17, 0.86)',
        border: `1px solid ${C.lineStrong}`,
        borderRadius: 28,
        boxShadow: '0 30px 80px rgba(0,0,0,0.45)',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

/** Small uppercase label with a pulsing dot, like the site's "Live" badge. */
export function Badge({ children, color = C.lime }: { children: ReactNode; color?: string }) {
  const t = useSeconds()
  const pulse = 0.55 + 0.45 * Math.abs(Math.sin(t * 2.2))
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 18px',
        borderRadius: 999,
        background: 'rgba(27, 42, 11, 0.85)',
        color,
        fontFamily: DISPLAY,
        fontSize: 22,
        fontWeight: 800,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
      }}
    >
      <span style={{ width: 12, height: 12, borderRadius: 99, background: color, opacity: pulse, boxShadow: `0 0 14px ${color}` }} />
      {children}
    </span>
  )
}
