// Scene lengths follow the narration: a short lead-in, the voice clip, then a tail. Scenes crossfade into each other.
import timing from './timing.json'
import { FPS } from './theme'

export type SceneId = 'hook' | 'dtcc' | 'gap' | 'brand' | 'live' | 'how' | 'arc' | 'consent' | 'proof' | 'outro'

export const LEAD = 0.35
const TAIL: Partial<Record<SceneId, number>> = { gap: 0.9, brand: 1.2, live: 2.2, outro: 3.2 }
export const XFADE = 14

export interface Slot {
  id: SceneId
  text: string
  /** Voice clip length, seconds. */
  voice: number
  /** Scene length, frames. */
  frames: number
  /** First frame of the scene in the whole video. */
  start: number
}

let cursor = 0
export const SLOTS: Slot[] = timing.narration.map((n, i) => {
  const frames = Math.ceil((LEAD + n.duration + (TAIL[n.id as SceneId] ?? 0.8)) * FPS)
  const slot = { id: n.id as SceneId, text: n.text, voice: n.duration, frames, start: cursor - (i > 0 ? XFADE : 0) }
  cursor = slot.start + frames
  return slot
})

export const TOTAL = cursor
