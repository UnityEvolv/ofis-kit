import { newId } from '@unityevolv/ofiskit-template'

import type { IceServer, RoomCall } from './protocol/index.js'

/**
 * The RTC provider interface, server half, and the call as a thing in its own
 * right.
 *
 * A provider is **two halves** and both must exist for it to be usable: this one,
 * and a client adapter in the realtime client. That split is what lets the
 * controls bar, the tiles and the indicators work identically whether the call is
 * a peer-to-peer mesh or somebody's SFU — none of them knows which.
 *
 * The built-in provider below is the reference implementation and the only one
 * here. Adding a second means writing these methods and a client adapter, and
 * touching no call, presence or UI code. That is the property this interface
 * exists to have, and the one worth protecting in review.
 */

/**
 * What a provider can do.
 *
 * Declared rather than assumed, because the UI disables what is unavailable and
 * has to be able to say why. The participant cap is also the ceiling on room
 * capacity, so it is not a detail the call layer can keep to itself.
 */
export interface ProviderLimits {
  maxParticipants: number
  video: boolean
  screenShare: boolean
  /** Recording on the provider's servers. Local recording is a client feature. */
  serverRecording: boolean
}

/**
 * How a provider charges.
 *
 * Nothing here bills anyone: the free office logs and forgets. It is declared so
 * the usage epic in the wrapper has something to attribute against, and so that a
 * provider cannot be added without somebody having thought about what it costs.
 *
 * Minor units, never a float, like every other amount of money in this product.
 */
export interface ProviderCost {
  /** What the meter actually counts. */
  model: 'egress' | 'participant-minutes' | 'none'
  minorUnitsPerUnit?: number
  currency?: string
}

export interface CallContext {
  officeId: string
  roomId: string
  callId: string
}

export interface ParticipantContext extends CallContext {
  userId: string
  /** A leg is a device, not a person: one person may have two. */
  deviceId: string
  displayName: string
}

export interface ParticipantCredentials {
  /** Whatever this provider's client adapter needs. The core never reads it. */
  credentials: unknown
  iceServers: IceServer[]
}

export interface RtcServerPlugin {
  /** Stable, and what a call record names. */
  readonly name: string
  readonly limits: ProviderLimits
  readonly cost: ProviderCost
  /**
   * The origins its client adapter connects to.
   *
   * Declared so a host can build a content security policy without knowing which
   * providers exist. The built-in provider reaches only our own socket and
   * whatever relay the host configures, so it declares none of its own.
   */
  readonly origins: readonly string[]

  createCall(context: CallContext): Promise<void>
  endCall(context: CallContext): Promise<void>
  credentialsFor(context: ParticipantContext): Promise<ParticipantCredentials>
}

/**
 * The hooks a host may bind, and the free office leaves unbound.
 *
 * This is where the wrapper's call records, usage and cost attribution attach.
 * Every one is optional and **none of them can refuse anything**: a hook that
 * could say no would be a permission check hiding outside the identity adapter.
 *
 * They are called by the call model rather than by each provider, so a provider
 * cannot forget to report.
 */
export interface CallHooks {
  onCallStarted?(call: RoomCall & { callId: string; officeId: string }): void
  onCallEnded?(event: { callId: string; officeId: string; roomId: string; endedAt: string }): void
  onParticipantJoined?(context: ParticipantContext): void
  onParticipantLeft?(event: ParticipantContext & { relayed: boolean | null }): void
  /**
   * Connection quality, sampled from the client.
   *
   * The free office does nothing with it; unityofis feeds it to the usage epic.
   * Relayed bytes are the number that costs money, and they arrive here.
   */
  onQualitySample?(event: {
    callId: string
    officeId: string
    userId: string
    deviceId: string
    peerDeviceId: string
    relayed: boolean
    packetLoss: number
    roundTripMs: number
  }): void
  /** A call that could not connect at all, with the reason ICE gave. */
  onConnectionFailed?(event: {
    callId: string
    officeId: string
    userId: string
    deviceId: string
    reason: string
  }): void
}

/**
 * What the built-in provider needs to hand a client.
 *
 * Empty here: a mesh on one network needs nothing but each other's addresses.
 * The relay credentials arrive with the story that configures a relay, and they
 * arrive through this option rather than as a new provider.
 */
export interface BuiltInProviderOptions {
  iceServersFor?(context: ParticipantContext): IceServer[]
}

/**
 * The built-in provider: peer-to-peer WebRTC, signalled over the socket we
 * already have.
 *
 * It has no server to create a call on, which is exactly why it is the free
 * tier: the core relays offers, answers and candidates, and never sees a byte of
 * media. `createCall` therefore does nothing at all, and that is not a stub —
 * there is genuinely nothing to do.
 *
 * **Four participants**, because a full mesh has every participant sending their
 * camera separately to every other one. Five people is twenty streams and a
 * sender uploading four copies of their own video, with a screen share on top of
 * that — the heaviest thing peer-to-peer does.
 */
export function builtInProvider(options: BuiltInProviderOptions = {}): RtcServerPlugin {
  return {
    name: 'builtin',
    limits: {
      maxParticipants: 4,
      video: true,
      screenShare: true,
      // No server exists to record on. Recording to the person's own device is a
      // client feature and works on every provider, so it is not declared here.
      serverRecording: false,
    },
    cost: { model: 'egress' },
    origins: [],

    async createCall() {},
    async endCall() {},

    async credentialsFor(context): Promise<ParticipantCredentials> {
      return {
        // The mesh needs no token: the peers are each other, and the socket
        // already knows who everybody is. What it needs is a way through a
        // corporate firewall, which is a relay credential and arrives with the
        // story that configures one.
        credentials: { transport: 'mesh' },
        iceServers: options.iceServersFor?.(context) ?? [],
      }
    },
  }
}

/** One device's leg in a call. */
export interface CallLeg {
  userId: string
  deviceId: string
  displayName: string
  joinedAt: string
  muted: boolean
  cameraOn: boolean
  sharing: boolean
  speaking: boolean
  /** When they last started speaking, so tile order is the same for everybody. */
  lastSpokeAt: string | null
  /**
   * When they raised their hand, or null if it is down.
   *
   * An instant rather than a flag, because the queue is the point: whoever asked
   * first is listed first. Stamped here so everybody in the call sees the same
   * order, and gone with the leg when they leave — a hand cannot stay up in a
   * call somebody is no longer in.
   */
  handRaisedAt: string | null
  /**
   * Held through the disconnect grace period, so a room cannot fill past
   * somebody whose wifi blinked. Null once they are really gone.
   */
  reconnectingUntil: string | null
}

export interface LiveCall {
  callId: string
  officeId: string
  roomId: string
  /** Fixed when the call starts. A provider change applies to the next call. */
  provider: string
  startedAt: string
  legs: Map<string, CallLeg>
}

/**
 * The calls happening right now.
 *
 * Deliberately separate from presence: entering a room does not join its call,
 * and a person is in the room whether or not they are in the conversation
 * happening in it. Joining is always explicit — pressing the microphone or the
 * camera is what does it.
 *
 * In memory, like the rest of the free office. A call cannot outlive the process
 * relaying its signalling, so there is nothing a store would be protecting.
 */
export class CallRegistry {
  readonly #calls = new Map<string, LiveCall>()
  readonly #provider: RtcServerPlugin
  readonly #hooks: CallHooks
  readonly #now: () => number

  constructor(
    provider: RtcServerPlugin,
    hooks: CallHooks = {},
    now: () => number = () => Date.now(),
  ) {
    this.#provider = provider
    this.#hooks = hooks
    this.#now = now
  }

  get provider(): RtcServerPlugin {
    return this.#provider
  }

  #key(officeId: string, roomId: string): string {
    return `${officeId}:${roomId}`
  }

  get(officeId: string, roomId: string): LiveCall | null {
    return this.#calls.get(this.#key(officeId, roomId)) ?? null
  }

  all(officeId: string): LiveCall[] {
    return [...this.#calls.values()].filter((call) => call.officeId === officeId)
  }

  /** How many legs count against the cap — reconnecting ones included. */
  size(officeId: string, roomId: string): number {
    return this.get(officeId, roomId)?.legs.size ?? 0
  }

  /** Whether one more leg would exceed the provider's cap. */
  isFull(officeId: string, roomId: string): boolean {
    return this.size(officeId, roomId) >= this.#provider.limits.maxParticipants
  }

  /**
   * Put a leg into the room's call, starting the call if this is the first one.
   *
   * A call exists from the first person turning on audio or video until the last
   * participant leaves. **Silence never ends it**: somebody sitting quietly in a
   * call is still in the call.
   */
  async join(
    officeId: string,
    roomId: string,
    leg: Pick<CallLeg, 'userId' | 'deviceId' | 'displayName'>,
    media: { audio: boolean; video: boolean },
  ): Promise<{ call: LiveCall; credentials: ParticipantCredentials }> {
    const key = this.#key(officeId, roomId)
    let call = this.#calls.get(key)

    if (!call) {
      call = {
        callId: newId(),
        officeId,
        roomId,
        provider: this.#provider.name,
        startedAt: new Date(this.#now()).toISOString(),
        legs: new Map(),
      }
      this.#calls.set(key, call)
      await this.#provider.createCall({ officeId, roomId, callId: call.callId })
      this.#hooks.onCallStarted?.({ ...this.toPublic(call), callId: call.callId, officeId })
    }

    const full: CallLeg = {
      ...leg,
      joinedAt: new Date(this.#now()).toISOString(),
      muted: !media.audio,
      cameraOn: media.video,
      sharing: false,
      speaking: false,
      lastSpokeAt: null,
      handRaisedAt: null,
      reconnectingUntil: null,
    }
    call.legs.set(leg.deviceId, full)

    const context: ParticipantContext = {
      officeId,
      roomId,
      callId: call.callId,
      userId: leg.userId,
      deviceId: leg.deviceId,
      displayName: leg.displayName,
    }
    this.#hooks.onParticipantJoined?.(context)

    return { call, credentials: await this.#provider.credentialsFor(context) }
  }

  /**
   * Take a leg out, ending the call if it was the last one.
   *
   * Anything that removes somebody from a room ends their leg the same way
   * leaving does: a template edit deleting the room, access revoked, the tab
   * closing. **There is one path out**, so there is one place for it to be wrong.
   */
  async leave(
    officeId: string,
    roomId: string,
    deviceId: string,
    relayed: boolean | null = null,
  ): Promise<LiveCall | null> {
    const key = this.#key(officeId, roomId)
    const call = this.#calls.get(key)
    const leg = call?.legs.get(deviceId)
    if (!call || !leg) return null

    call.legs.delete(deviceId)
    this.#hooks.onParticipantLeft?.({
      officeId,
      roomId,
      callId: call.callId,
      userId: leg.userId,
      deviceId,
      displayName: leg.displayName,
      relayed,
    })

    if (call.legs.size === 0) {
      this.#calls.delete(key)
      await this.#provider.endCall({ officeId, roomId, callId: call.callId })
      this.#hooks.onCallEnded?.({
        callId: call.callId,
        officeId,
        roomId,
        endedAt: new Date(this.#now()).toISOString(),
      })
      return null
    }

    return call
  }

  /** Every leg belonging to one person in one call. */
  legsOf(officeId: string, roomId: string, userId: string): CallLeg[] {
    const call = this.get(officeId, roomId)
    if (!call) return []
    return [...call.legs.values()].filter((leg) => leg.userId === userId)
  }

  /** Whichever call this device is in, wherever it is. */
  findByDevice(deviceId: string): LiveCall | null {
    for (const call of this.#calls.values()) {
      if (call.legs.has(deviceId)) return call
    }
    return null
  }

  /** Update what a leg is publishing. Returns the call, or null when not in one. */
  setMedia(
    officeId: string,
    roomId: string,
    deviceId: string,
    state: Partial<Pick<CallLeg, 'muted' | 'cameraOn' | 'sharing' | 'speaking'>>,
  ): LiveCall | null {
    const call = this.get(officeId, roomId)
    const leg = call?.legs.get(deviceId)
    if (!call || !leg) return null

    // Stamped on the way up only. Ordering by "last started speaking" is what
    // keeps a tile still while somebody talks, rather than re-sorting on every
    // level report.
    if (state.speaking === true && !leg.speaking) {
      leg.lastSpokeAt = new Date(this.#now()).toISOString()
    }

    Object.assign(leg, state)
    return call
  }

  /**
   * Put a hand up, or take it down.
   *
   * Raising a hand that is already up is deliberately a no-op rather than a
   * restamp: the order of raising is what the queue is, and a second press moving
   * somebody to the back of it would be a bug that only shows up as "why am I
   * last". Returns the call, or null when this device is not in one.
   */
  setHand(officeId: string, roomId: string, deviceId: string, raised: boolean): LiveCall | null {
    const call = this.get(officeId, roomId)
    const leg = call?.legs.get(deviceId)
    if (!call || !leg) return null

    if (!raised) leg.handRaisedAt = null
    else if (leg.handRaisedAt === null) leg.handRaisedAt = new Date(this.#now()).toISOString()

    return call
  }

  /**
   * Hands that are up, in the order they went up.
   *
   * The queue, and the reason the tile strip can put people who asked to speak
   * ahead of people who happen to have spoken recently.
   */
  raisedHands(officeId: string, roomId: string): CallLeg[] {
    const call = this.get(officeId, roomId)
    if (!call) return []
    return [...call.legs.values()]
      .filter((leg) => leg.handRaisedAt !== null)
      .sort((a, b) => String(a.handRaisedAt).localeCompare(String(b.handRaisedAt)))
  }

  /**
   * Hold a leg's seat while its connection is away.
   *
   * A device that drops mid-call and comes back within the grace period rejoins
   * in the state it left, so the room cannot fill past somebody who is still on
   * their way back.
   */
  hold(officeId: string, roomId: string, deviceId: string, until: string): void {
    const leg = this.get(officeId, roomId)?.legs.get(deviceId)
    if (leg) leg.reconnectingUntil = until
  }

  /** They came back. The leg is theirs again, in the state they left it. */
  release(officeId: string, roomId: string, deviceId: string): CallLeg | null {
    const leg = this.get(officeId, roomId)?.legs.get(deviceId)
    if (!leg) return null
    leg.reconnectingUntil = null
    return leg
  }

  toPublic(call: LiveCall): RoomCall {
    return {
      roomId: call.roomId,
      provider: call.provider,
      startedAt: call.startedAt,
      participants: [...call.legs.values()].map((leg) => ({
        userId: leg.userId,
        deviceId: leg.deviceId,
      })),
      limit: this.#provider.limits.maxParticipants,
    }
  }

  /** Straight through to the host's hook. Nothing here reads these. */
  sample(event: Parameters<NonNullable<CallHooks['onQualitySample']>>[0]): void {
    this.#hooks.onQualitySample?.(event)
  }

  failed(event: Parameters<NonNullable<CallHooks['onConnectionFailed']>>[0]): void {
    this.#hooks.onConnectionFailed?.(event)
  }
}
