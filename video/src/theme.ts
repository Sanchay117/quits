// "Ledger lime", the site's palette: ink-green neutrals, electric lime for money that clears, mint for money in,
// coral-rose for money out. Display type is Bricolage Grotesque, big figures Instrument Serif, code JetBrains Mono.
import type { CSSProperties } from 'react'
import { loadFont as loadDisplay } from '@remotion/google-fonts/BricolageGrotesque'
import { loadFont as loadSerif } from '@remotion/google-fonts/InstrumentSerif'
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono'

export const FPS = 30

export const DISPLAY = loadDisplay('normal', { weights: ['400', '600', '800'], subsets: ['latin'] }).fontFamily
export const SERIF = loadSerif('normal', { weights: ['400'], subsets: ['latin'] }).fontFamily
export const SERIF_ITALIC = loadSerif('italic', { weights: ['400'], subsets: ['latin'] }).fontFamily
export const MONO = loadMono('normal', { weights: ['400', '700'], subsets: ['latin'] }).fontFamily

export const C = {
  bg: '#090c0a',
  surface: '#101511',
  surface2: '#161d17',
  ink: '#edf2e8',
  ink2: '#c7d0c1',
  muted: '#8f9c89',
  line: '#202920',
  lineStrong: '#314032',
  edge: '#8a9785',
  lime: '#c6f24e',
  limeStrong: '#b6ec24',
  limeSoft: '#1b2a0b',
  glow: 'rgba(190, 242, 70, 0.45)',
  mint: '#5eead4',
  rose: '#fb7185',
  amber: '#f5d547',
}

/** The CSS variables the app's graph.css reads, so the real graph renders in the site's dark theme. */
export const GRAPH_TOKENS = {
  '--bg': C.bg,
  '--surface': C.surface,
  '--surface-2': C.surface2,
  '--ink': C.ink,
  '--ink-2': C.ink2,
  '--muted': C.muted,
  '--line': C.line,
  '--line-strong': C.lineStrong,
  '--edge': C.edge,
  '--accent': C.lime,
  '--accent-strong': C.limeStrong,
  '--accent-soft': C.limeSoft,
  '--glow': C.glow,
  '--good': C.mint,
  '--bad': C.rose,
  '--font': DISPLAY,
} as CSSProperties
