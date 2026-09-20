import type {
  Ack,
  DeviceKind,
  OfficeDiff,
  OfficeSnapshot,
} from '@unityevolv/ofiskit-realtime-core/protocol'
import { io, type Socket } from 'socket.io-client'

import {
  applyChange,
  applyDiff,
  emptyOffice,
  fromSnapshot,
  type OfficeState,
} from './office-state.js'

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
  | { type: 'template.changed' }
  /** A move or an action the server refused, with the reason to show. */
  | { type: 'refused'; action: string; code: string; message: string }
  | { type: 'status'; status: ConnectionStatus }
  | { type: 'closed'; code: string; message: string }

export interface OfisClientOptions {
  /** Where the socket lives. From configuration; never a literal in the app. */
  url: string
  path?: string
  /** Stable per installation, so a reconnect is recognised as the same device. */
  deviceId: string
  kind?: DeviceKind
  /** How often to tell the server we are still here. */
  heartbeatMs?: number
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
}

export function createOfisClient(options: OfisClientOptions): OfisClient {
  const socket: Socket = io(options.url, {
    path: options.path ?? '/socket',
    auth: { deviceId: options.deviceId, kind: options.kind ?? 'web' },
    transports: ['websocket', 'polling'],
  })

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

  socket.on('template:changed', () => emit({ type: 'template.changed' }))

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
  }
}
