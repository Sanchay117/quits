import { Composition } from 'remotion'
import { Demo } from './Video'
import { FPS } from './theme'
import { TOTAL } from './timing'

export const Root = () => <Composition id="Demo" component={Demo} durationInFrames={TOTAL} fps={FPS} width={1920} height={1080} />
