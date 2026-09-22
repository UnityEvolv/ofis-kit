/**
 * The office's sounds: a knock at the door, and a chime when somebody arrives.
 *
 * Made here with the Web Audio API rather than played from files. There is no audio
 * file to ship, license or fetch — this repository never reaches anything it does not
 * contain — and each sound is a few lines of arithmetic that can be tuned in place.
 *
 * Both are short and quiet on purpose. A notification sound in an office is heard by
 * everybody near the person's desk, and a sound that is too long or too loud is one
 * people turn off, after which it tells nobody anything.
 */

export interface Sounds {
  /** Somebody is knocking on the door of the room you are in. */
  knock(): void
  /** Somebody walked into the room you are in, or you were let into one. */
  chime(): void
  /** Send the sounds to the speaker chosen for calls, where the browser can. */
  useSpeaker(deviceId: string | undefined): void
}

/** The loudest either sound gets. Well under full scale: this is a nudge, not an alarm. */
const VOLUME = 0.35

type AudioContextLike = AudioContext & { setSinkId?(sinkId: string): Promise<void> }

/**
 * The browser's sounds, made on demand.
 *
 * The audio context is created on the first sound rather than up front: browsers
 * refuse to start one before the page has been interacted with, and by the time
 * there is somebody to knock, the person has at least pressed "Walk in". If the
 * browser still refuses, or has no Web Audio at all, the sound is silently skipped —
 * a missing chime is never worth an error.
 */
export function createSounds(): Sounds {
  let context: AudioContextLike | null = null
  let speaker: string | undefined

  const ready = (): AudioContextLike | null => {
    const Context = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext
    if (!Context) return null
    try {
      context ??= new Context() as AudioContextLike
      if (context.state === 'suspended') void context.resume().catch(() => {})
      if (speaker && typeof context.setSinkId === 'function') {
        void context.setSinkId(speaker).catch(() => {})
      }
      return context
    } catch {
      return null
    }
  }

  return {
    knock() {
      const audio = ready()
      if (audio) knockAt(audio, audio.currentTime)
    },
    chime() {
      const audio = ready()
      if (audio) chimeAt(audio, audio.currentTime)
    },
    useSpeaker(deviceId) {
      speaker = deviceId
      if (context && deviceId && typeof context.setSinkId === 'function') {
        void context.setSinkId(deviceId).catch(() => {})
      }
    },
  }
}

/**
 * Two knuckle taps on a wooden door: knock-knock.
 *
 * Each tap is a low tone that drops in pitch as it dies — the body of the door —
 * over a short burst of filtered noise, which is the knuckle. Two of them, a little
 * under a fifth of a second apart, is what reads as a knock rather than a thud.
 */
function knockAt(audio: AudioContext, start: number): void {
  for (const offset of [0, 0.17]) {
    const at = start + offset

    const body = audio.createOscillator()
    body.type = 'triangle'
    body.frequency.setValueAtTime(180, at)
    body.frequency.exponentialRampToValueAtTime(70, at + 0.09)

    const bodyGain = audio.createGain()
    bodyGain.gain.setValueAtTime(0.0001, at)
    bodyGain.gain.exponentialRampToValueAtTime(VOLUME, at + 0.004)
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.14)
    body.connect(bodyGain).connect(audio.destination)
    body.start(at)
    body.stop(at + 0.15)

    const noise = audio.createBufferSource()
    noise.buffer = noiseBuffer(audio, 0.04)
    const knuckle = audio.createBiquadFilter()
    knuckle.type = 'lowpass'
    knuckle.frequency.value = 1200
    const noiseGain = audio.createGain()
    noiseGain.gain.setValueAtTime(VOLUME * 0.6, at)
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.04)
    noise.connect(knuckle).connect(noiseGain).connect(audio.destination)
    noise.start(at)
    noise.stop(at + 0.05)
  }
}

/**
 * A short, bright "bling": two bell-like notes a fifth apart, the second a beat
 * behind the first, both fading over about half a second.
 */
function chimeAt(audio: AudioContext, start: number): void {
  for (const [frequency, offset] of [
    [1046.5, 0],
    [1568, 0.09],
  ] as const) {
    const at = start + offset

    const tone = audio.createOscillator()
    tone.type = 'sine'
    tone.frequency.setValueAtTime(frequency, at)

    const gain = audio.createGain()
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(VOLUME * 0.7, at + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.55)

    tone.connect(gain).connect(audio.destination)
    tone.start(at)
    tone.stop(at + 0.6)
  }
}

function noiseBuffer(audio: AudioContext, seconds: number): AudioBuffer {
  const buffer = audio.createBuffer(
    1,
    Math.max(1, Math.floor(audio.sampleRate * seconds)),
    audio.sampleRate,
  )
  const samples = buffer.getChannelData(0)
  for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1
  return buffer
}
