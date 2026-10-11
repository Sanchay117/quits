// Narration audio, one clip per scene, from Deepgram (key DEEPGRAM_API in ../.env), then src/timing.json with each
// clip's duration so the scenes are paced to the voice. Clips are cached by (voice, text): re-runs only redo changes.
// Usage: node tts.mjs [--voice flux-sienna-en]
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { SCENES } from './narration.mjs'

const i = process.argv.indexOf('--voice')
const VOICE = i > 0 ? process.argv[i + 1] : 'flux-sienna-en'
const key = readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/^DEEPGRAM_API=(\S+)/m)?.[1]
if (!key) throw new Error('DEEPGRAM_API missing from ../.env')
const OUT = new URL('public/audio/', import.meta.url)
mkdirSync(OUT, { recursive: true })

async function synth(text) {
  const version = VOICE.startsWith('flux') ? 'v2' : 'v1'
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://api.deepgram.com/${version}/speak?model=${VOICE}&encoding=mp3`, {
      method: 'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (res.ok) return Buffer.from(await res.arrayBuffer())
    const body = await res.text()
    if (attempt >= 4 || [400, 401, 402, 403].includes(res.status)) throw new Error(`${res.status} ${body.slice(0, 200)}`)
    await new Promise((r) => setTimeout(r, attempt * 4000))
  }
}

const duration = (file) =>
  Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim())

const timing = []
for (const scene of SCENES) {
  const say = scene.say ?? scene.text
  const hash = createHash('sha256').update(`${VOICE}\n${say}`).digest('hex').slice(0, 12)
  const file = new URL(`${scene.id}.mp3`, OUT)
  const stamp = new URL(`${scene.id}.hash`, OUT)
  if (!existsSync(file) || !existsSync(stamp) || readFileSync(stamp, 'utf8') !== hash) {
    writeFileSync(file, await synth(say))
    writeFileSync(stamp, hash)
    console.log(`  synthesized ${scene.id}`)
  }
  const seconds = duration(file.pathname)
  const words = say.split(/\s+/).length
  console.log(`${scene.id.padEnd(8)} ${seconds.toFixed(2)}s  ${Math.round((words / seconds) * 60)} wpm`)
  timing.push({ id: scene.id, text: scene.text, duration: seconds })
}
writeFileSync(new URL('src/timing.json', import.meta.url), JSON.stringify({ voice: VOICE, narration: timing }, null, 2) + '\n')
console.log(`total ${timing.reduce((s, t) => s + t.duration, 0).toFixed(1)}s of narration`)
