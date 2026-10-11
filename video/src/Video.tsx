// The whole cut: scenes crossfade or slide into each other, each with its narration clip and karaoke captions, over
// an original music bed that ducks under the voice and fades out at the end.
import { Fragment, type ReactElement } from 'react'
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile } from 'remotion'
import { linearTiming, TransitionSeries } from '@remotion/transitions'
import { fade } from '@remotion/transitions/fade'
import { slide } from '@remotion/transitions/slide'
import { iris } from '@remotion/transitions/iris'
import { wipe } from '@remotion/transitions/wipe'
import { Captions } from './kit'
import { ArcScene, Consent, How, Outro, Proof } from './scenesB'
import { Brand, Dtcc, Gap, Hook, Live } from './scenesA'
import { FPS } from './theme'
import { LEAD, SLOTS, TOTAL, XFADE, type SceneId, type Slot } from './timing'

function scene(slot: Slot): ReactElement {
  const p = { voice: slot.voice }
  const map: Record<SceneId, ReactElement> = {
    hook: <Hook {...p} />,
    dtcc: <Dtcc {...p} />,
    gap: <Gap />,
    brand: <Brand />,
    live: <Live {...p} />,
    how: <How {...p} />,
    arc: <ArcScene {...p} />,
    consent: <Consent {...p} />,
    proof: <Proof {...p} />,
    outro: <Outro />,
  }
  return map[slot.id]
}

/** How each scene enters: an iris for the brand and outro, wipes and slides between ideas, fades elsewhere. */
function enter(id: SceneId): ReactElement {
  const timing = linearTiming({ durationInFrames: XFADE })
  if (id === 'brand' || id === 'outro') return <TransitionSeries.Transition presentation={iris({ width: 1920, height: 1080 })} timing={timing} />
  if (id === 'live' || id === 'consent') return <TransitionSeries.Transition presentation={wipe({ direction: 'from-top-left' })} timing={timing} />
  if (id === 'how' || id === 'arc' || id === 'proof') return <TransitionSeries.Transition presentation={slide({ direction: 'from-right' })} timing={timing} />
  return <TransitionSeries.Transition presentation={fade()} timing={timing} />
}

/** Music level: low under the voice, up in the gaps, faded in and out. */
function musicVolume(frame: number): number {
  const fadeIn = interpolate(frame, [0, 45], [0, 1], { extrapolateRight: 'clamp' })
  const fadeOut = interpolate(frame, [TOTAL - 90, TOTAL - 1], [1, 0], { extrapolateLeft: 'clamp' })
  const speaking = SLOTS.some((s) => {
    const from = s.start + LEAD * FPS - 6
    const to = s.start + (LEAD + s.voice) * FPS + 6
    return frame >= from && frame <= to
  })
  return (speaking ? 0.16 : 0.32) * fadeIn * fadeOut
}

export function Demo() {
  return (
    <AbsoluteFill style={{ background: '#090c0a' }}>
      <TransitionSeries>
        {SLOTS.map((slot, i) => (
          <Fragment key={slot.id}>
            {i > 0 && enter(slot.id)}
            <TransitionSeries.Sequence durationInFrames={slot.frames}>{scene(slot)}</TransitionSeries.Sequence>
          </Fragment>
        ))}
      </TransitionSeries>
      {SLOTS.map((slot) => (
        <Sequence key={slot.id} from={slot.start} durationInFrames={slot.frames}>
          <Sequence from={Math.round(LEAD * FPS)}>
            <Audio src={staticFile(`audio/${slot.id}.mp3`)} />
          </Sequence>
          <Captions text={slot.text} voice={slot.voice} />
        </Sequence>
      ))}
      <Audio src={staticFile('music.wav')} volume={musicVolume} />
    </AbsoluteFill>
  )
}
