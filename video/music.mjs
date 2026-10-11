// Composes an original background track in code (no samples, no licence): a bright major-key
// electronic bed at 108 BPM with a detuned-saw pad, sub bass, plucked arpeggio, soft kick
// and hats, through a stereo feedback delay. Writes 16-bit WAV.
// usage: node music.mjs [seconds] [out.wav]
import { writeFileSync } from 'node:fs'

const SECONDS = Number(process.argv[2] ?? 112)
const OUT = process.argv[3] ?? new URL('./public/music.wav', import.meta.url).pathname
const SR = 44100
const N = Math.floor(SECONDS * SR)
const BPM = 108
const BEAT = 60 / BPM
const BAR = 4 * BEAT
const L = new Float32Array(N)
const R = new Float32Array(N)

const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12)
// C - G - Am - F, two bars each (midi roots), with voicings: hopeful, resolving
const PROG = [
    { root: 48, chord: [55, 60, 64, 67] }, // C
    { root: 43, chord: [55, 59, 62, 67] }, // G
    { root: 45, chord: [57, 60, 64, 69] }, // Am
    { root: 41, chord: [57, 60, 65, 69] }, // F
]
const chordAt = (t) => PROG[Math.floor(t / (2 * BAR)) % PROG.length]

// arrangement: 0-1 envelopes over time
const ramp = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)))
const fadeOut = (t) => 1 - ramp(t, SECONDS - 5, SECONDS)
const energy = (t) => ramp(t, 6, 10) // drums and arp enter after the intro

let seed = 7
const noise = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 31 - 1
}

// ---- pad: 3 detuned saws per note, one-pole lowpass that slowly opens, sidechain pump
{
    const phases = new Float64Array(64)
    let lpL = 0
    let lpR = 0
    for (let i = 0; i < N; i++) {
        const t = i / SR
        const ch = chordAt(t)
        let sL = 0
        let sR = 0
        ch.chord.forEach((m, n) => {
            for (let d = 0; d < 3; d++) {
                const k = n * 3 + d
                const det = [-0.11, 0, 0.12][d]
                phases[k] = (phases[k] + hz(m + det) / SR) % 1
                const saw = 2 * phases[k] - 1
                if (d === 0) sL += saw
                else if (d === 2) sR += saw
                else {
                    sL += saw * 0.5
                    sR += saw * 0.5
                }
            }
        })
        const cutoff = 600 + 900 * (0.5 + 0.5 * Math.sin(t / 7)) + 600 * energy(t)
        const a = 1 - Math.exp((-2 * Math.PI * cutoff) / SR)
        lpL += a * (sL - lpL)
        lpR += a * (sR - lpR)
        const beatPos = (t % BEAT) / BEAT
        const pump = 1 - 0.45 * energy(t) * Math.exp(-beatPos * 6)
        const amp = 0.035 * ramp(t, 0, 5) * fadeOut(t) * pump
        L[i] += lpL * amp
        R[i] += lpR * amp
    }
}

// ---- sub bass: sine on the chord root, eighth-note pulse
{
    let ph = 0
    for (let i = 0; i < N; i++) {
        const t = i / SR
        ph = (ph + hz(chordAt(t).root - 12 + 12) / SR) % 1
        const e = (t % (BEAT / 2)) / (BEAT / 2)
        const env = Math.exp(-e * 3.5)
        const s = Math.sin(2 * Math.PI * ph) * env * 0.11 * energy(t) * fadeOut(t)
        L[i] += s
        R[i] += s
    }
}

// ---- plucked arpeggio: 16ths over the chord, panned, into the delay below
const arpL = new Float32Array(N)
const arpR = new Float32Array(N)
{
    const step = BEAT / 4
    const pattern = [0, 2, 1, 3, 2, 1, 3, 2]
    for (let s = 0; s * step < SECONDS; s++) {
        const t0 = s * step
        const ch = chordAt(t0)
        const m = ch.chord[pattern[s % pattern.length]] + 12
        const f = hz(m)
        const pan = 0.5 + 0.35 * Math.sin(s * 0.7)
        const vel = (s % 4 === 0 ? 1 : 0.7) * 0.045 * ramp(t0, 14, 22) * fadeOut(t0)
        if (vel <= 0) continue
        const start = Math.floor(t0 * SR)
        const len = Math.floor(0.45 * SR)
        for (let j = 0; j < len && start + j < N; j++) {
            const tt = j / SR
            const env = Math.exp(-tt * 9)
            const v = (Math.sin(2 * Math.PI * f * tt) + 0.3 * Math.sin(4 * Math.PI * f * tt)) * env * vel
            arpL[start + j] += v * (1 - pan)
            arpR[start + j] += v * pan
        }
    }
}

// ---- kick (pitch-dropped sine) on every beat, hats on offbeats
{
    for (let b = 0; b * BEAT < SECONDS; b++) {
        const t0 = b * BEAT
        const kv = 0.2 * energy(t0) * fadeOut(t0)
        const start = Math.floor(t0 * SR)
        if (kv > 0) {
            let ph = 0
            for (let j = 0; j < 0.3 * SR && start + j < N; j++) {
                const tt = j / SR
                ph += (45 + 110 * Math.exp(-tt * 30)) / SR
                const v = Math.sin(2 * Math.PI * ph) * Math.exp(-tt * 9) * kv
                L[start + j] += v
                R[start + j] += v
            }
        }
        const hv = 0.05 * ramp(t0, 22, 26) * fadeOut(t0)
        const hs = Math.floor((t0 + BEAT / 2) * SR)
        if (hv > 0) {
            let hp = 0
            let prev = 0
            for (let j = 0; j < 0.05 * SR && hs + j < N; j++) {
                const x = noise()
                hp = 0.85 * (hp + x - prev) // crude high-pass
                prev = x
                const v = hp * Math.exp((-j / SR) * 70) * hv
                L[hs + j] += v * 0.8
                R[hs + j] += v
            }
        }
    }
}

// ---- stereo ping-pong delay on the arp (dotted eighth), then mix in
{
    const d = Math.floor(BEAT * 0.75 * SR)
    const bufL = new Float32Array(N)
    const bufR = new Float32Array(N)
    for (let i = 0; i < N; i++) {
        const inL = arpL[i] + (i >= d ? bufR[i - d] * 0.42 : 0)
        const inR = arpR[i] + (i >= d ? bufL[i - d] * 0.42 : 0)
        bufL[i] = inL
        bufR[i] = inR
        L[i] += inL * 0.9
        R[i] += inR * 0.9
    }
}

// ---- normalise to -3 dBFS peak and write WAV
let peak = 0
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]))
const gain = 0.707 / peak
const buf = Buffer.alloc(44 + N * 4)
buf.write('RIFF', 0)
buf.writeUInt32LE(36 + N * 4, 4)
buf.write('WAVE', 8)
buf.write('fmt ', 12)
buf.writeUInt32LE(16, 16)
buf.writeUInt16LE(1, 20)
buf.writeUInt16LE(2, 22)
buf.writeUInt32LE(SR, 24)
buf.writeUInt32LE(SR * 4, 28)
buf.writeUInt16LE(4, 32)
buf.writeUInt16LE(16, 34)
buf.write('data', 36)
buf.writeUInt32LE(N * 4, 40)
for (let i = 0; i < N; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * gain)) * 32767), 44 + i * 4)
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * gain)) * 32767), 46 + i * 4)
}
writeFileSync(OUT, buf)
console.log(`wrote ${OUT} (${SECONDS}s, peak ${peak.toFixed(2)} -> -3 dBFS)`)
