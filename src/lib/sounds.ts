// Little synthesized sound effects (no audio files), with a remembered mute setting.

const MUTE_KEY = 'heroscape-draft:muted'

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

export function setMuted(muted: boolean) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
  } catch {
    // Not remembered; fine for this visit.
  }
}

/** Runs `play` with a fresh AudioContext, closing it once the sound is done. */
function withAudio(durationSeconds: number, play: (ctx: AudioContext, out: AudioNode) => void) {
  if (isMuted()) return
  try {
    const ctx = new AudioContext()
    const out = ctx.createGain()
    out.gain.value = 0.9
    out.connect(ctx.destination)
    play(ctx, out)
    setTimeout(() => ctx.close(), (durationSeconds + 0.5) * 1000)
  } catch {
    // Audio unavailable or blocked; the visuals still show what happened.
  }
}

/** Two soft rising notes: it's your turn. */
export function playTurnChime() {
  withAudio(0.6, (ctx, out) => {
    ;[660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.value = freq
      const t = ctx.currentTime + i * 0.18
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
      osc.connect(gain).connect(out)
      osc.start(t)
      osc.stop(t + 0.32)
    })
  })
}

/** White noise, the raw material for drum skins and the sword scrape. */
function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return buf
}

/** One deep war-drum hit: a pitched-down body plus a short skin thud. */
function warDrum(ctx: AudioContext, out: AudioNode, t: number, strength: number) {
  const body = ctx.createOscillator()
  const bodyGain = ctx.createGain()
  body.type = 'sine'
  body.frequency.setValueAtTime(95, t)
  body.frequency.exponentialRampToValueAtTime(38, t + 0.45)
  bodyGain.gain.setValueAtTime(0.0001, t)
  bodyGain.gain.exponentialRampToValueAtTime(0.9 * strength, t + 0.008)
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.7)
  body.connect(bodyGain).connect(out)
  body.start(t)
  body.stop(t + 0.75)

  const skin = ctx.createBufferSource()
  skin.buffer = noiseBuffer(ctx, 0.2)
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 700
  const skinGain = ctx.createGain()
  skinGain.gain.setValueAtTime(0.5 * strength, t)
  skinGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15)
  skin.connect(lp).connect(skinGain).connect(out)
  skin.start(t)
  skin.stop(t + 0.2)
}

/** War drums, a low brass swell and a sword drawn from its scabbard: you drafted a unit. */
export function playDraftFanfare() {
  withAudio(2.2, (ctx, out) => {
    const now = ctx.currentTime

    // Boom ... boom ... BOOM.
    warDrum(ctx, out, now, 0.7)
    warDrum(ctx, out, now + 0.32, 0.75)
    warDrum(ctx, out, now + 0.64, 1)

    // Dark open fifth (D2 + A2) in low brass, swelling in under the last hit.
    const horn = ctx.createBiquadFilter()
    horn.type = 'lowpass'
    horn.Q.value = 1.5
    const hornStart = now + 0.6
    horn.frequency.setValueAtTime(220, hornStart)
    horn.frequency.linearRampToValueAtTime(900, hornStart + 0.5)
    horn.frequency.linearRampToValueAtTime(400, hornStart + 1.4)
    const hornGain = ctx.createGain()
    hornGain.gain.setValueAtTime(0.0001, hornStart)
    hornGain.gain.exponentialRampToValueAtTime(0.14, hornStart + 0.35)
    hornGain.gain.setValueAtTime(0.14, hornStart + 0.9)
    hornGain.gain.exponentialRampToValueAtTime(0.0001, hornStart + 1.5)
    horn.connect(hornGain).connect(out)
    for (const [freq, detune] of [
      [73.42, -6],
      [73.42, 6],
      [110, 0],
    ]) {
      const osc = ctx.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.value = freq
      osc.detune.value = detune
      osc.connect(horn)
      osc.start(hornStart)
      osc.stop(hornStart + 1.55)
    }

    // Sword draw: a rising metallic scrape out of the scabbard...
    const drawStart = now + 0.75
    const scrape = ctx.createBufferSource()
    scrape.buffer = noiseBuffer(ctx, 0.6)
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 8
    bp.frequency.setValueAtTime(1800, drawStart)
    bp.frequency.exponentialRampToValueAtTime(6500, drawStart + 0.5)
    const scrapeGain = ctx.createGain()
    scrapeGain.gain.setValueAtTime(0.0001, drawStart)
    scrapeGain.gain.exponentialRampToValueAtTime(0.35, drawStart + 0.4)
    scrapeGain.gain.exponentialRampToValueAtTime(0.0001, drawStart + 0.55)
    scrape.connect(bp).connect(scrapeGain).connect(out)
    scrape.start(drawStart)
    scrape.stop(drawStart + 0.6)

    // ...ending in a cold ring: clashing, inharmonic partials like struck steel.
    const ringStart = drawStart + 0.48
    for (const [freq, level, decay] of [
      [2350, 0.05, 1.1],
      [3687, 0.035, 0.8],
      [5130, 0.025, 0.6],
      [6920, 0.015, 0.4],
    ]) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, ringStart)
      gain.gain.exponentialRampToValueAtTime(level, ringStart + 0.005)
      gain.gain.exponentialRampToValueAtTime(0.0001, ringStart + decay)
      osc.connect(gain).connect(out)
      osc.start(ringStart)
      osc.stop(ringStart + decay + 0.05)
    }
  })
}
