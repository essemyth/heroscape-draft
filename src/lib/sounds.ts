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

/** Battle horn fanfare plus a sword being drawn: you drafted a unit. */
export function playDraftFanfare() {
  withAudio(1.4, (ctx, out) => {
    const now = ctx.currentTime

    // Brassy horn: detuned sawtooths through a lowpass that opens on each note.
    const notes: [number, number, number][] = [
      // [frequency, start, length]
      [392.0, 0.0, 0.12], // G4
      [392.0, 0.14, 0.12], // G4
      [523.25, 0.28, 0.14], // C5
      [659.25, 0.44, 0.7], // E5, held
    ]
    for (const [freq, start, length] of notes) {
      const t = now + start
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.Q.value = 2
      filter.frequency.setValueAtTime(600, t)
      filter.frequency.exponentialRampToValueAtTime(3200, t + 0.05)
      filter.frequency.exponentialRampToValueAtTime(1400, t + length)
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.03)
      gain.gain.setValueAtTime(0.18, t + length * 0.7)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + length + 0.12)
      filter.connect(gain).connect(out)
      for (const detune of [-8, 0, 8]) {
        const osc = ctx.createOscillator()
        osc.type = 'sawtooth'
        osc.frequency.value = freq
        osc.detune.value = detune
        osc.connect(filter)
        osc.start(t)
        osc.stop(t + length + 0.15)
      }
    }

    // Low drum hit under the first note.
    const drum = ctx.createOscillator()
    const drumGain = ctx.createGain()
    drum.type = 'sine'
    drum.frequency.setValueAtTime(140, now)
    drum.frequency.exponentialRampToValueAtTime(50, now + 0.25)
    drumGain.gain.setValueAtTime(0.5, now)
    drumGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3)
    drum.connect(drumGain).connect(out)
    drum.start(now)
    drum.stop(now + 0.32)

    // Sword "shing" on the held note: bright filtered noise with a ringing tone.
    const t = now + 0.44
    const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate)
    const data = noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    src.buffer = noise
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.setValueAtTime(3000, t)
    hp.frequency.exponentialRampToValueAtTime(7000, t + 0.35)
    const noiseGain = ctx.createGain()
    noiseGain.gain.setValueAtTime(0.0001, t)
    noiseGain.gain.exponentialRampToValueAtTime(0.12, t + 0.02)
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45)
    src.connect(hp).connect(noiseGain).connect(out)
    src.start(t)
    src.stop(t + 0.5)

    const ring = ctx.createOscillator()
    const ringGain = ctx.createGain()
    ring.type = 'sine'
    ring.frequency.value = 2637 // E7, a metallic ring
    ringGain.gain.setValueAtTime(0.0001, t)
    ringGain.gain.exponentialRampToValueAtTime(0.05, t + 0.01)
    ringGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6)
    ring.connect(ringGain).connect(out)
    ring.start(t)
    ring.stop(t + 0.65)
  })
}
