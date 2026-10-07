/**
 * The room's background loop, played in this browser and nowhere else.
 *
 * Ambience is never mixed into a call. Every client plays its own copy, from its
 * own start, and nothing is synchronised: two people in the same room hearing
 * the same loop at different points cannot tell, so there is no socket traffic,
 * no server state and no provider involved. That is also why it never reaches a
 * recording, a relay or a transcript.
 *
 * Web Audio rather than an `<audio>` element, because an element's `loop` leaves
 * an audible gap at the seam and a decoded buffer looping in place does not. Each
 * loop is fetched and decoded once per player, which the host keeps for the
 * session, so walking back into a room does not download its loop again.
 *
 * Whether to play is never decided here: the host says what to play and how loud,
 * and the person's own switch arrives as "stop". The player only knows how.
 */

/** How long a loop takes to come in or go out. Long enough not to startle, short enough to feel prompt. */
export const AMBIENCE_FADE_MS = 400

/** How far the loop dips under a knock or a chime, as a fraction of its volume. */
export const AMBIENCE_DUCK_LEVEL = 0.2

/** How long the dip holds before the loop comes back up. A knock is over well inside it. */
export const AMBIENCE_DUCK_HOLD_MS = 900

/** The longest a loop may take to arrive before the player gives up on it. */
export const AMBIENCE_LOAD_TIMEOUT_MS = 20_000

/**
 * How long to wait for the browser to start audio before calling it refused.
 *
 * A browser that will allow audio starts at once; one waiting for a gesture
 * never resolves at all, so a short wait is the only way to tell them apart.
 */
const RESUME_WAIT_MS = 250

/**
 * What came of asking for a loop.
 *
 * `blocked` is the browser's autoplay rule, not a failure: it starts after the
 * person presses something, and the indicator offers exactly that.
 */
export type AmbiencePlayback = 'playing' | 'blocked' | 'failed'

export interface AmbiencePlayer {
  /** Play this loop at this volume (0..1), fading over whatever was playing. */
  play(src: string, volume: number): Promise<AmbiencePlayback>
  /** Fade out and let go of the loop. Safe to call when nothing is playing. */
  stop(): void
  setVolume(volume: number): void
  /** Dip briefly under a notification sound, so a knock is never buried. */
  duck(): void
  /**
   * Allow audio, from inside a press or a key.
   *
   * Browsers refuse audio before a gesture; after one, the rest of the session
   * may play without asking. True when audio is now allowed.
   */
  unlock(): Promise<boolean>
  /** Send the loop to the speaker chosen for calls, where the browser can. */
  useSpeaker(deviceId: string | undefined): void
  /** Release the audio context. The player is not used again after this. */
  close(): void
}

type AudioContextLike = AudioContext & { setSinkId?(sinkId: string): Promise<void> }

interface Voice {
  src: string
  source: AudioBufferSourceNode
  fade: GainNode
}

/**
 * Loudness follows the square of the slider, which is closer to how a person
 * hears it: a linear gain spends most of the slider's travel being too loud.
 */
export function ambienceGain(volume: number): number {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 0))
  return clamped * clamped
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

/**
 * The browser's player.
 *
 * Silently does nothing where there is no Web Audio, which is a missing
 * atmosphere and not worth an error.
 */
export function createAmbiencePlayer(
  options: { fetch?: typeof fetch; context?: () => AudioContextLike | null } = {},
): AmbiencePlayer {
  const load = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
  let context: AudioContextLike | null = null
  let volumeNode: GainNode | null = null
  let duckNode: GainNode | null = null
  let voice: Voice | null = null
  let speaker: string | undefined
  let volume = 0
  let generation = 0
  const buffers = new Map<string, Promise<AudioBuffer>>()

  const audio = (): AudioContextLike | null => {
    if (context) return context
    try {
      const made =
        options.context?.() ??
        (() => {
          const Context = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext
          return Context ? (new Context() as AudioContextLike) : null
        })()
      if (!made) return null
      context = made
      volumeNode = made.createGain()
      duckNode = made.createGain()
      volumeNode.gain.value = ambienceGain(volume)
      duckNode.connect(volumeNode).connect(made.destination)
      if (speaker && typeof made.setSinkId === 'function') {
        void made.setSinkId(speaker).catch(() => {})
      }
      return made
    } catch {
      return null
    }
  }

  const running = async (audible: AudioContextLike): Promise<boolean> => {
    if (audible.state === 'running') return true
    // A resume that the browser is holding back never settles, so it is raced
    // against a short wait rather than awaited.
    await Promise.race([audible.resume().catch(() => {}), wait(RESUME_WAIT_MS)])
    return (audible.state as AudioContextState) === 'running'
  }

  const decode = (audible: AudioContextLike, src: string): Promise<AudioBuffer> => {
    const cached = buffers.get(src)
    if (cached) return cached
    const signal =
      typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
        ? AbortSignal.timeout(AMBIENCE_LOAD_TIMEOUT_MS)
        : undefined
    const pending = load(src, signal ? { signal } : {})
      .then((response) => {
        if (!response.ok) throw new Error(`The ambience loop answered ${response.status}.`)
        return response.arrayBuffer()
      })
      .then((bytes) => audible.decodeAudioData(bytes))
    // A failure is not remembered: the next room with this loop tries again.
    pending.catch(() => buffers.delete(src))
    buffers.set(src, pending)
    return pending
  }

  const fadeOut = (audible: AudioContextLike, leaving: Voice) => {
    const now = audible.currentTime
    const seconds = AMBIENCE_FADE_MS / 1000
    leaving.fade.gain.cancelScheduledValues(now)
    leaving.fade.gain.setValueAtTime(leaving.fade.gain.value, now)
    leaving.fade.gain.linearRampToValueAtTime(0, now + seconds)
    try {
      leaving.source.stop(now + seconds + 0.05)
    } catch {
      // Already stopped.
    }
  }

  return {
    async play(src, nextVolume) {
      const mine = ++generation
      volume = nextVolume
      const audible = audio()
      if (!audible || !duckNode || !volumeNode) return 'failed'
      volumeNode.gain.setTargetAtTime(ambienceGain(volume), audible.currentTime, 0.05)

      if (voice?.src === src) return (await running(audible)) ? 'playing' : 'blocked'

      let buffer: AudioBuffer
      try {
        buffer = await decode(audible, src)
      } catch {
        return mine === generation ? 'failed' : 'playing'
      }
      // Something newer was asked for while this one loaded; it decides.
      if (mine !== generation) return 'playing'

      if (voice) fadeOut(audible, voice)
      const source = audible.createBufferSource()
      source.buffer = buffer
      source.loop = true
      const fade = audible.createGain()
      const now = audible.currentTime
      fade.gain.setValueAtTime(0, now)
      fade.gain.linearRampToValueAtTime(1, now + AMBIENCE_FADE_MS / 1000)
      source.connect(fade).connect(duckNode)
      source.start()
      voice = { src, source, fade }

      return (await running(audible)) ? 'playing' : 'blocked'
    },

    stop() {
      generation += 1
      if (context && voice) fadeOut(context, voice)
      voice = null
    },

    setVolume(nextVolume) {
      volume = nextVolume
      if (context && volumeNode) {
        volumeNode.gain.setTargetAtTime(ambienceGain(volume), context.currentTime, 0.05)
      }
    },

    duck() {
      if (!context || !duckNode || !voice) return
      const now = context.currentTime
      const gain = duckNode.gain
      gain.cancelScheduledValues(now)
      gain.setValueAtTime(gain.value, now)
      gain.linearRampToValueAtTime(AMBIENCE_DUCK_LEVEL, now + 0.05)
      gain.setValueAtTime(AMBIENCE_DUCK_LEVEL, now + AMBIENCE_DUCK_HOLD_MS / 1000)
      gain.linearRampToValueAtTime(1, now + (AMBIENCE_DUCK_HOLD_MS + AMBIENCE_FADE_MS) / 1000)
    },

    async unlock() {
      const audible = audio()
      return audible ? running(audible) : false
    },

    useSpeaker(deviceId) {
      speaker = deviceId
      if (context && deviceId && typeof context.setSinkId === 'function') {
        void context.setSinkId(deviceId).catch(() => {})
      }
    },

    close() {
      generation += 1
      voice = null
      void context?.close().catch(() => {})
      context = null
      volumeNode = null
      duckNode = null
    },
  }
}
