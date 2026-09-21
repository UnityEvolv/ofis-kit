import type {
  Ack,
  CallJoinResponse,
  CustomStatus,
  DeviceKind,
  ManualStatus,
  OfficeDiff,
  OfficeSnapshot,
  SignalMessage,
} from '@unityevolv/ofiskit-realtime-core/protocol'
import { io, type Socket } from 'socket.io-client'

import {
  applyChange,
  applyDiff,
  emptyOffice,
  fromSnapshot,
  type OfficeState,
} from './office-state.js'
import type { RtcClientAdapter, RtcEvent, Signaller } from './rtc/adapter.js'
import { meshAdapter } from './rtc/mesh.js'

/**
 * The office, on the client.
 *
 * One object holding the socket and the office state, so a UI subscribes to one
 * thing and renders. Both the web map and a React Native list use this; only the
 * drawing differs, which is why there is no DOM anywhere in this package.
 */

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed'

/** Things that happen *to* you, which the UI announces rather than only draws. */
export type ClientEvent =
  /** Somebody is at the door of the room you are in. */
  | {
      type: 'knock'
      knockId: string
      roomId: string
      userId: string
      displayName: string
      photoUrl?: string
      /** True when everybody inside is on do not disturb: it arrived silently. */
      silent: boolean
    }
  /** A knock is over, one way or another — including nobody answering. */
  | { type: 'knock.resolved'; knockId: string; outcome: 'admitted' | 'declined' | 'expired' }
  /** You were let in. An invitation to move, not a reservation. */
  | { type: 'admitted'; roomId: string; byUserId: string }
  | { type: 'template.changed' }
  /**
   * Somebody in your room reacted.
   *
   * An event rather than state, because a reaction is not state: it floats over
   * whoever sent it for a few seconds and then it is gone, and nothing about it is
   * stored here or on the server. A client that was not listening missed it,
   * which is what happens with a nod in a room.
   */
  | {
      type: 'reaction'
      roomId: string
      userId: string
      /** Which screen it came from, so it floats over the right tile. */
      deviceId: string
      reaction: string
      at: string
    }
  /** A move or an action the server refused, with the reason to show. */
  | { type: 'refused'; action: string; code: string; message: string }
  | { type: 'status'; status: ConnectionStatus }
  | { type: 'closed'; code: string; message: string }
  /** Everything the provider's client half reports, in one shape. */
  | { type: 'rtc'; event: RtcEvent }

/**
 * The little of Socket.IO this client actually uses.
 *
 * Named so the client can be driven without a network, for the same reason the
 * engine takes a `Transport`: the rules worth testing here are what happens to
 * the office state when a diff skips a number or a move is refused, and none of
 * those need a socket to be true. It is also the seam a host would replace to run
 * this over something else entirely.
 */
export interface SocketLike {
  on(event: string, handler: (...args: never[]) => void): unknown
  off(event: string, handler: (...args: never[]) => void): unknown
  emit(event: string, ...args: unknown[]): unknown
  disconnect(): unknown
  /** Socket.IO's manager, which is where reconnection attempts are announced. */
  io: { on(event: string, handler: (...args: never[]) => void): unknown }
}

export interface OfisClientOptions {
  /** Where the socket lives. From configuration; never a literal in the app. */
  url: string
  path?: string
  /** Stable per installation, so a reconnect is recognised as the same device. */
  deviceId: string
  kind?: DeviceKind
  /** How often to tell the server we are still here. */
  heartbeatMs?: number
  /**
   * The provider's client half.
   *
   * The built-in mesh unless a host swaps it, which is the other half of what
   * makes a provider replaceable: a plugin on the server and an adapter here, and
   * no UI change between them.
   */
  rtc?: (signaller: Signaller) => RtcClientAdapter
  /**
   * How to open the socket. Socket.IO unless somebody says otherwise.
   *
   * Tests pass a fake here. So could a host on a different transport, which is
   * the only reason this is an option rather than a test-only hook.
   */
  connect?(options: OfisClientOptions): SocketLike
}

export interface OfisClient {
  state(): OfficeState
  /** Called on every state change. Returns its own unsubscribe. */
  subscribe(listener: (state: OfficeState) => void): () => void
  on(listener: (event: ClientEvent) => void): () => void
  status(): ConnectionStatus

  enter(credentials: unknown): Promise<Ack<{ snapshot: OfficeSnapshot }>>
  leave(): Promise<void>
  close(): void

  joinRoom(roomId: string): Promise<Ack>
  leaveRoom(): Promise<Ack>
  lock(roomId: string): Promise<Ack>
  unlock(roomId: string): Promise<Ack>
  knock(roomId: string): Promise<Ack<{ knockId: string; silent: boolean }>>
  /** Let one person in, without unlocking the room for anybody else. */
  admit(knockId: string): Promise<Ack>
  decline(knockId: string): Promise<Ack>

  /** A status the person chose. null puts them back on automatic. */
  setStatus(manual: ManualStatus | null): Promise<Ack>
  setCustomStatus(custom: CustomStatus | null): Promise<Ack>
  /** One device's own signals. Never a conclusion about the person. */
  setActivity(activity: { idle: boolean; foreground: boolean }): void

  /**
   * Join the call in your room, and start publishing.
   *
   * Two things in one, deliberately: the server's answer carries the credentials
   * and the participant list the adapter needs, and a caller that had to sequence
   * them itself would be a caller that could get the order wrong.
   */
  joinCall(options: {
    audio: boolean
    video: boolean
    secondDevice?: 'move' | 'add'
  }): Promise<Ack<{ call: CallJoinResponse }>>
  leaveCall(): Promise<Ack>

  /**
   * Put your hand up, or take it down.
   *
   * A socket event and not media, so it behaves identically on the built-in
   * provider and on anybody else's — and it loads no provider SDK to do it.
   */
  raiseHand(raised: boolean): Promise<Ack>
  /** React, without interrupting. Rate limited by the server, which may refuse. */
  react(reaction: string): Promise<Ack>

  /** The provider's client half. What the controls bar and the tiles talk to. */
  rtc: RtcClientAdapter
}

/** Socket.IO, which is what every real deployment uses. */
function openSocket(options: OfisClientOptions): SocketLike {
  const socket: Socket = io(options.url, {
    path: options.path ?? '/socket',
    auth: { deviceId: options.deviceId, kind: options.kind ?? 'web' },
    transports: ['websocket', 'polling'],
  })
  return socket as unknown as SocketLike
}

export function createOfisClient(options: OfisClientOptions): OfisClient {
  const socket = (options.connect ?? openSocket)(options)

  let state = emptyOffice()
  let connection: ConnectionStatus = 'idle'
  let credentials: unknown = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let resyncing = false

  const listeners = new Set<(state: OfficeState) => void>()
  const events = new Set<(event: ClientEvent) => void>()

  const publish = (next: OfficeState) => {
    state = next
    // Copied before iterating, because a listener may unsubscribe as it runs.
    for (const listener of [...listeners]) listener(state)
  }

  const emit = (event: ClientEvent) => {
    for (const listener of [...events]) listener(event)
  }

  const setStatusTo = (next: ConnectionStatus) => {
    if (connection === next) return
    connection = next
    emit({ type: 'status', status: next })
  }

  /** Every request goes through here, so every one is answered or times out. */
  function ask<T>(event: string, payload?: unknown): Promise<Ack<T>> {
    return new Promise((resolve) => {
      const args = payload === undefined ? [] : [payload]
      const timer = setTimeout(() => {
        // A request with no answer is not a refusal and must not look like one:
        // the message says to try again, where a refusal would say why not to.
        resolve({
          ok: false,
          code: 'client.timeout',
          message: 'The office did not answer. Check your connection and try again.',
        })
      }, 10_000)

      socket.emit(event, ...args, (result: Ack<T>) => {
        clearTimeout(timer)
        resolve(result ?? { ok: false, code: 'client.no_reply', message: 'No answer.' })
      })
    })
  }

  /**
   * The gap handler.
   *
   * A client that misses a diff must not carry on drawing: it asks for a fresh
   * snapshot. Guarded, so a burst of out-of-order diffs asks once rather than
   * once per diff — and a resync is a full office, which is exactly what the
   * diffs exist to avoid sending.
   */
  async function resync(): Promise<void> {
    if (resyncing) return
    resyncing = true
    try {
      const result = await ask<{ snapshot: OfficeSnapshot }>('office:resync')
      if (result.ok) publish(fromSnapshot(result.snapshot))
    } finally {
      resyncing = false
    }
  }

  socket.on('connect', () => {
    setStatusTo('connected')
    // A reconnect re-enters with the credentials already in hand, so the person
    // is back in the room they were in without touching anything.
    if (credentials !== null) void enter(credentials)
  })

  socket.on('disconnect', () => setStatusTo('reconnecting'))
  socket.io.on('reconnect_attempt', () => setStatusTo('reconnecting'))

  socket.on('office:diff', (diff: OfficeDiff) => {
    const outcome = applyDiff(state, diff)
    if (outcome.kind === 'applied') publish(outcome.state)
    else if (outcome.kind === 'resync') void resync()
  })

  socket.on(
    'knock:received',
    (event: {
      knockId: string
      roomId: string
      userId: string
      displayName: string
      photoUrl?: string
      silent: boolean
    }) => emit({ type: 'knock', ...event }),
  )

  socket.on(
    'knock:resolved',
    (event: { knockId: string; outcome: 'admitted' | 'declined' | 'expired' }) =>
      emit({ type: 'knock.resolved', ...event }),
  )

  socket.on('knock:admitted', (event: { roomId: string; byUserId: string }) =>
    emit({ type: 'admitted', ...event }),
  )

  socket.on('template:changed', () => emit({ type: 'template.changed' }))

  socket.on(
    'call:reaction',
    (event: { roomId: string; userId: string; deviceId: string; reaction: string; at: string }) =>
      emit({ type: 'reaction', ...event }),
  )

  /**
   * How the adapter reaches the other legs.
   *
   * Over the socket that is already open, which is the whole of the built-in
   * provider's signalling. An external provider's adapter would not use this at
   * all — it would talk to its own servers, and our socket would carry only call
   * state.
   */
  const signaller: Signaller = {
    send(message) {
      socket.emit('signal', message)
    },
    receive(handler) {
      const wrapped = (message: SignalMessage & { from: string }) => handler(message)
      socket.on('signal', wrapped as (...args: never[]) => void)
      return () => socket.off('signal', wrapped as (...args: never[]) => void)
    },
  }

  const rtc = (options.rtc ?? meshAdapter)(signaller)

  /*
   * The adapter's events are the only thing the UI hears about the call — and
   * three of them have to reach the server as well.
   *
   * Speaking drives the indicators for everybody else, so it cannot stay local.
   * Media state is reported *after* the adapter did it, so a camera that failed to
   * start never shows as on. Quality feeds the host's usage hook, and the relayed
   * flag in it is the number that costs money.
   */
  rtc.on((event) => {
    if (event.type === 'speaking') {
      socket.emit('call:speaking', { speaking: event.speaking })
    }
    if (event.type === 'state') {
      socket.emit('call:media', {
        muted: event.muted,
        cameraOn: event.cameraOn,
        sharing: event.sharing,
      })
    }
    if (event.type === 'quality') {
      socket.emit('call:quality', {
        peerDeviceId: event.deviceId,
        relayed: event.relayed,
        packetLoss: event.packetLoss,
        roundTripMs: event.roundTripMs,
      })
    }
    // A call that could not connect at all, reported once so a host can see how
    // often its network requirements are the problem.
    if (event.type === 'failed' && !event.deviceId) {
      socket.emit('call:failed', { reason: event.reason })
    }
    emit({ type: 'rtc', event })
  })

  socket.on('disconnected', (reason: { code: string; message: string }) => {
    // Told why, rather than just going quiet. The client stops retrying, because
    // retrying a revoked credential forever helps nobody.
    credentials = null
    setStatusTo('closed')
    emit({ type: 'closed', ...reason })
    socket.disconnect()
  })

  async function enter(given: unknown): Promise<Ack<{ snapshot: OfficeSnapshot }>> {
    credentials = given
    setStatusTo('connecting')

    const result = await ask<{ snapshot: OfficeSnapshot }>('office:enter', {
      credentials: given,
      deviceId: options.deviceId,
      kind: options.kind ?? 'web',
    })

    if (result.ok) {
      publish(fromSnapshot(result.snapshot))
      setStatusTo('connected')

      if (heartbeat) clearInterval(heartbeat)
      heartbeat = setInterval(() => {
        void ask('heartbeat')
      }, options.heartbeatMs ?? 20_000)
    } else {
      credentials = null
      setStatusTo('idle')
    }

    return result
  }

  return {
    state: () => state,

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    on(listener) {
      events.add(listener)
      return () => events.delete(listener)
    },

    status: () => connection,

    enter,

    async leave() {
      await ask('office:leave')
      credentials = null
      if (heartbeat) clearInterval(heartbeat)
      heartbeat = null
      publish(emptyOffice())
    },

    close() {
      if (heartbeat) clearInterval(heartbeat)
      heartbeat = null
      socket.disconnect()
      setStatusTo('closed')
    },

    /**
     * Move, optimistically.
     *
     * The avatar moves the moment it is clicked, because waiting a round trip to
     * watch your own click land feels broken. The server's answer is still the
     * authority: a refusal snaps the avatar back and says why, and the next diff
     * overwrites whatever was guessed here either way.
     *
     * Which is also how two devices acting at once resolve. Both guess, one is
     * refused, and the diff that follows is the same office on both.
     */
    async joinRoom(roomId: string) {
      const me = state.people.get(state.you.userId)
      const previous = me?.roomId

      if (me) {
        publish(
          applyChange(state, {
            kind: 'person.moved',
            userId: me.userId,
            roomId,
            arrivedAt: new Date().toISOString(),
          }),
        )
      }

      const result = await ask('room:join', { roomId })

      if (!result.ok && me && previous) {
        publish(
          applyChange(state, {
            kind: 'person.moved',
            userId: me.userId,
            roomId: previous,
            arrivedAt: me.arrivedAt,
          }),
        )
        emit({ type: 'refused', action: 'room:join', code: result.code, message: result.message })
      }

      return result
    },

    leaveRoom: () => ask('room:leave'),
    lock: (roomId) => ask('room:lock', { roomId }),
    unlock: (roomId) => ask('room:unlock', { roomId }),
    knock: (roomId) => ask<{ knockId: string; silent: boolean }>('room:knock', { roomId }),
    admit: (knockId) => ask('knock:admit', { knockId }),
    decline: (knockId) => ask('knock:decline', { knockId }),

    /**
     * Set, or clear, a status the person chose.
     *
     * The choice is recorded here as well as sent, because `you.manual` is what
     * the control reads to decide whether to offer a way back to automatic, and
     * it arrives only in a snapshot. Waiting for the next one would leave the
     * control a step behind its own button.
     */
    async setStatus(manual) {
      const result = await ask('status:manual', { manual })
      if (result.ok) publish({ ...state, you: { ...state.you, manual } })
      return result
    },

    setCustomStatus: (custom) => ask('status:custom', { custom }),

    setActivity(activity) {
      // No acknowledgement: these arrive constantly and nobody waits on them.
      socket.emit('device:activity', activity)
    },

    async joinCall(wanted) {
      const result = await ask<{ call: CallJoinResponse }>('call:join', wanted)
      if (!result.ok) {
        emit({ type: 'refused', action: 'call:join', code: result.code, message: result.message })
        return result
      }

      // The server's answer first, then the media. The other order would mean
      // publishing to a call that might refuse us.
      await rtc.join({
        callId: result.call.call.roomId,
        deviceId: state.you.deviceId || options.deviceId,
        credentials: result.call.credentials,
        iceServers: result.call.iceServers,
        participants: result.call.participants,
        audio: wanted.audio,
        video: wanted.video,
      })

      return result
    },

    async leaveCall() {
      // The media first: tearing down locally before telling the server means
      // nobody is left looking at a tile for a camera that has already stopped.
      await rtc.leave()
      return ask('call:leave')
    },

    raiseHand: (raised) => ask('call:hand', { raised }),

    /**
     * React, and say so if it was refused.
     *
     * The refusal is announced like any other, because a reaction that silently
     * does nothing looks like a broken button — and the limit is the reason it
     * would happen.
     */
    async react(reaction) {
      const result = await ask('call:react', { reaction })
      if (!result.ok) {
        emit({ type: 'refused', action: 'call:react', code: result.code, message: result.message })
      }
      return result
    },

    rtc,
  }
}
