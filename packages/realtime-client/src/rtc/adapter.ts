import type { IceServer, SignalMessage } from '@unityevolv/ofiskit-realtime-core/protocol'

/**
 * The RTC provider interface, client half.
 *
 * The other half is the server plugin in the core, and **both must exist** for a
 * provider to be usable. This is the one the controls bar, the tiles and the
 * indicators actually talk to: none of them imports a provider SDK, they consume
 * the events below in one shape whichever provider is behind them.
 *
 * The built-in mesh adapter is the reference implementation and arrives with the
 * signalling story. An external provider's adapter wraps that provider's SDK and
 * talks to their servers; our socket carries only call state, never their media
 * or signalling.
 *
 * No DOM anywhere except the media types, which React Native shims — which is
 * why this lives in the platform-agnostic package and the tiles do not.
 */

/** One thing that happened in the call, in the shape every provider reports. */
export type RtcEvent =
  | { type: 'participant.joined'; deviceId: string; userId: string; displayName: string }
  | { type: 'participant.left'; deviceId: string }
  /**
   * A stream arrived from a peer.
   *
   * `source` separates a camera from a screen share, because they are laid out
   * completely differently and a share that arrives as a camera tile is useless.
   */
  | { type: 'track'; deviceId: string; stream: MediaStream; source: 'camera' | 'screen' | 'audio' }
  | { type: 'track.ended'; deviceId: string; source: 'camera' | 'screen' | 'audio' }
  /** Your own microphone level, a few times a second and only while it changes. */
  | { type: 'speaking'; speaking: boolean; level: number }
  | { type: 'quality'; deviceId: string; relayed: boolean; packetLoss: number; roundTripMs: number }
  /** What you are publishing, reported after the adapter actually did it. */
  | { type: 'state'; muted: boolean; cameraOn: boolean; sharing: boolean }
  /**
   * A connection failed.
   *
   * `deviceId` present means one peer is unreachable and the rest of the call is
   * fine, which is worth saying precisely: a three-way call with one unreachable
   * person is not a total failure and must not be reported as one.
   */
  | { type: 'failed'; deviceId?: string; reason: string }
  /** Your own video was reduced, so nobody has to wonder why they look blurry. */
  | { type: 'degraded'; videoDropped: boolean; reason: string }
  | { type: 'local'; stream: MediaStream | null; source: 'camera' | 'screen' }

export type RtcHandler = (event: RtcEvent) => void

export interface JoinOptions {
  callId: string
  /** Who this client is, as a call leg. A leg is a device, not a person. */
  deviceId: string
  /** Whatever the server plugin issued. The adapter is the only thing that reads it. */
  credentials: unknown
  iceServers: IceServer[]
  /** Who is already here, so a new peer knows who to connect to. */
  participants: Array<{ userId: string; deviceId: string; displayName: string }>
  audio: boolean
  video: boolean
  /** Chosen devices, from the device picker. */
  audioDeviceId?: string
  videoDeviceId?: string
}

/**
 * How the adapter reaches the other side.
 *
 * Injected rather than imported, so the adapter does not know whether it is
 * talking over our socket or a provider's own channel. The built-in adapter uses
 * our socket; an external one would not need this at all.
 */
export interface Signaller {
  send(message: SignalMessage): void
  receive(handler: (message: SignalMessage & { from: string }) => void): () => void
}

export interface RtcClientAdapter {
  join(options: JoinOptions): Promise<void>
  leave(): Promise<void>

  setMicrophone(on: boolean): Promise<void>
  setCamera(on: boolean): Promise<void>
  /** Returns false when the person cancelled the browser's picker. */
  startScreenShare(): Promise<boolean>
  stopScreenShare(): Promise<void>

  /**
   * Which peers should send video.
   *
   * Only the visible tiles receive video; everybody else is audio-only. Paging
   * the tile strip changes this set, and that is what bounds what each person
   * downloads however big the call gets.
   */
  setVideoSubscriptions(deviceIds: string[]): void

  /** Swap microphone or camera mid-call, from the device picker. */
  useDevices(devices: { audioDeviceId?: string; videoDeviceId?: string }): Promise<void>

  on(handler: RtcHandler): () => void
}

/**
 * Ceilings per stream, so four cameras plus a share stay inside what a home
 * connection can upload.
 *
 * A mesh cannot use simulcast: the sender uploads a separate copy to every peer,
 * so the **sender** has to do the adapting. These are the steps it moves between.
 */
export const VIDEO_STEPS = [
  { height: 720, maxBitrate: 1_200_000, maxFramerate: 30 },
  { height: 480, maxBitrate: 600_000, maxFramerate: 30 },
  { height: 360, maxBitrate: 300_000, maxFramerate: 24 },
  { height: 180, maxBitrate: 120_000, maxFramerate: 15 },
] as const

/**
 * The screen share's ceiling.
 *
 * Resolution is favoured over frame rate, because text has to stay readable and a
 * slightly jerky slide is far better than a sharp one nobody can read.
 */
export const SCREEN_CEILING = { maxBitrate: 1_500_000, maxFramerate: 8 } as const

/** Audio is protected and never steps down. Video degrades first, always. */
export const AUDIO_BITRATE = 32_000

/**
 * What counts as talking, and how long it goes on counting.
 *
 * The level is the root mean square of the waveform, which is volume — not the
 * average across the frequency bins, which is volume divided by however much of
 * the spectrum happens to be empty. A voice puts almost all of its energy below
 * two kilohertz, so averaging it across twenty-four kilohertz of mostly silence
 * gives a number an order of magnitude smaller than the sound actually is, and a
 * threshold picked against that number is a threshold nobody normal crosses.
 *
 * `SPEAKING_HOLD_MS` is what stops the ring strobing. Speech is not continuous:
 * there is a gap between every word and a longer one between sentences, and an
 * indicator that follows the waveform exactly flickers all the way through a
 * sentence. Holding it briefly after the level drops reads as "this is the person
 * talking" rather than as a light fault, and it cuts what goes over the socket,
 * because only a change is sent.
 */
export const SPEAKING_LEVEL = 0.05
export const SPEAKING_HOLD_MS = 1_000
/** How often the level is measured. Five times a second is under the eye's notice. */
export const LEVEL_INTERVAL_MS = 200

/**
 * How loud the waveform is, between 0 and 1.
 *
 * Takes the bytes an `AnalyserNode` gives for the time domain, where 128 is
 * silence and the distance either side of it is the amplitude. Pure and exported
 * so the one number the speaking indicator depends on can be tested without a
 * browser, an audio context or a microphone.
 */
export function rmsLevel(samples: Uint8Array): number {
  if (samples.length === 0) return 0
  let total = 0
  for (const sample of samples) {
    const amplitude = (sample - 128) / 128
    total += amplitude * amplitude
  }
  return Math.sqrt(total / samples.length)
}

/**
 * Whether this device counts as talking, now.
 *
 * `loudAt` is when the level was last above the threshold. Muting wins over the
 * hold: a muted microphone is silent, and an indicator that says otherwise for a
 * second afterwards is the one mistake this indicator must never make.
 */
export function speakingNow(state: { muted: boolean; loudAt: number; now: number }): boolean {
  return !state.muted && state.now - state.loudAt < SPEAKING_HOLD_MS
}

/**
 * How long to try before giving up.
 *
 * Bounded on purpose. Some networks block UDP and the relay ports outright, and
 * on those the connection is never going to happen; an indefinite spinner just
 * makes somebody wait longer to find that out.
 */
export const CONNECT_TIMEOUT_MS = 15_000
