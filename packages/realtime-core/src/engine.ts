import type {
  ConnectionContext,
  EventBus,
  HostEvent,
  Identity,
  IdentityAdapter,
  TemplateSource,
} from '@unityevolv/ofiskit-adapters'
import type { DeviceKind, Presence, PresenceStore } from '@unityevolv/ofiskit-presence-store'
import type { Room, Template } from '@unityevolv/ofiskit-template'

import { silentLogger, type Logger } from './logger.js'
import {
  Refusal,
  type Ack,
  type EnterOfficeRequest,
  type OfficeSnapshot,
  type PublicPresence,
  type Refused,
} from './protocol/index.js'
import type { Transport } from './transport.js'

/**
 * The office engine: every rule about who is where, in one place.
 *
 * It knows nothing about sockets. Everything arrives as a method call keyed by
 * a connection id and leaves through the transport, which is what lets the
 * rules be tested without a network and lets unityofis run this exact code with
 * Redis underneath and many nodes beside it.
 *
 * The rule that shapes the whole file: **every permission question is an
 * adapter call**. There is no membership table here to consult, and adding one
 * would make the free office and the product different programs.
 *
 * This is the skeleton — connecting, authenticating, arriving and leaving.
 * Moving between rooms, status, lock and knock, and calls each arrive with
 * their own story, and each one is a handler added here rather than a change to
 * what is already written.
 */

const fail = (code: string, message: string): Refused => ({ ok: false, code, message })
const done = (): Ack => ({ ok: true })

/** One open socket. */
interface Connection {
  connectionId: string
  deviceId: string
  kind: DeviceKind
  identity: Identity | null
  officeId: string | null
}

export interface OfficeEngineOptions {
  officeId: string
  store: PresenceStore
  identity: IdentityAdapter
  templates: TemplateSource
  transport: Transport
  /**
   * The one way in from outside the socket.
   *
   * The free office has no publisher at all, so nothing is ever pushed and the
   * whole mechanism costs nothing. unityofis binds it to a Redis pub/sub
   * bridge, so its identity service can end somebody's access on a connection
   * that is open right now.
   */
  events?: EventBus
  logger?: Logger
  now?: () => number
}

export class OfficeEngine {
  readonly #options: OfficeEngineOptions
  readonly #store: PresenceStore
  readonly #transport: Transport
  readonly #logger: Logger
  readonly #now: () => number

  readonly #connections = new Map<string, Connection>()
  /** userId → the connections that person has open. Presence is per user. */
  readonly #byUser = new Map<string, Set<string>>()
  #unsubscribe: (() => void) | null = null

  constructor(options: OfficeEngineOptions) {
    this.#options = options
    this.#store = options.store
    this.#transport = options.transport
    this.#logger = options.logger ?? silentLogger()
    this.#now = options.now ?? (() => Date.now())

    this.#unsubscribe =
      options.events?.subscribe((event) => {
        void this.#onHostEvent(event)
      }) ?? null
  }

  // ---------------------------------------------------------------- lifecycle

  /** A socket opened. Nobody knows who it is yet. */
  connected(context: ConnectionContext): void {
    this.#connections.set(context.connectionId, {
      connectionId: context.connectionId,
      deviceId: context.deviceId,
      kind: context.kind,
      identity: null,
      officeId: null,
    })
  }

  /**
   * Enter the office: authenticate, then land somewhere.
   *
   * Reception on a first arrival, and the room they were in on a reload or a
   * reconnect, because coming back to the lobby every time you refresh is the
   * kind of small rudeness that makes a product feel careless.
   */
  async enter(
    connectionId: string,
    request: EnterOfficeRequest,
  ): Promise<Ack<{ snapshot: OfficeSnapshot }>> {
    const connection = this.#connections.get(connectionId)
    if (!connection) return fail(Refusal.NOT_AUTHENTICATED, 'This connection is not open.')

    if (typeof request?.deviceId !== 'string' || request.deviceId.length === 0) {
      return fail(Refusal.MALFORMED, 'A device id is required.')
    }
    connection.deviceId = request.deviceId
    connection.kind = request.kind ?? 'web'

    const identity = await this.#options.identity.authenticate(request.credentials, {
      connectionId,
      deviceId: connection.deviceId,
      kind: connection.kind,
    })
    if ('authenticated' in identity) return fail(identity.code, identity.message)

    const officeId = this.#options.officeId
    const permitted = await this.#options.identity.may({
      permission: 'enter_office',
      identity,
      officeId,
    })
    if (!permitted.allowed) return fail(permitted.code, permitted.message)

    const template = await this.#options.templates.get(officeId)
    if (!template) return fail(Refusal.OFFICE_UNKNOWN, 'There is no office here.')

    // Presence is one office at a time, so arriving somewhere ends being
    // anywhere else. In the free office there is only ever one, but the rule
    // belongs to the core rather than to the host that happens to have two.
    const elsewhere = await this.#store.officeOf(identity.id)
    if (elsewhere && elsewhere !== officeId) await this.#endPresence(elsewhere, identity.id)

    connection.identity = identity
    connection.officeId = officeId
    this.#track(identity.id, connectionId)

    const at = new Date(this.#now()).toISOString()
    const existing = await this.#store.get(officeId, identity.id)

    const device = {
      connectionId,
      deviceId: connection.deviceId,
      kind: connection.kind,
      idle: false,
      foreground: true,
      connectedAt: at,
      lastSeenAt: at,
    }

    const presence: Presence = existing
      ? {
          ...existing,
          displayName: identity.displayName,
          ...(identity.photoUrl ? { photoUrl: identity.photoUrl } : {}),
          // A second device for somebody already here, or the same device back
          // after a reload — either way it replaces rather than accumulates.
          devices: [
            ...existing.devices.filter((one) => one.deviceId !== connection.deviceId),
            device,
          ],
        }
      : {
          userId: identity.id,
          officeId,
          roomId: receptionOf(template).id,
          displayName: identity.displayName,
          ...(identity.photoUrl ? { photoUrl: identity.photoUrl } : {}),
          devices: [device],
          inCall: false,
          enteredAt: at,
          arrivedAt: at,
        }

    await this.#store.put(presence)
    await this.#broadcast(officeId)

    this.#logger.info(existing ? 'rejoined' : 'entered office', {
      userId: identity.id,
      officeId,
      roomId: presence.roomId,
      connectionId,
    })

    return { ok: true, snapshot: await this.snapshot(connectionId) }
  }

  /**
   * A refreshed credential on a socket that is already open.
   *
   * Re-validated and the identity updated in place, so a token rotating during
   * a long call does not drop anybody's presence or make their avatar flicker.
   */
  async refreshAuth(connectionId: string, credentials: unknown): Promise<Ack> {
    const connection = this.#connections.get(connectionId)
    if (!connection?.identity) return fail(Refusal.NOT_AUTHENTICATED, 'Not signed in.')

    const identity = await this.#options.identity.authenticate(credentials, {
      connectionId,
      deviceId: connection.deviceId,
      kind: connection.kind,
    })

    if ('authenticated' in identity) {
      this.#transport.close(connectionId, { code: Refusal.AUTH_EXPIRED, message: identity.message })
      return fail(identity.code, identity.message)
    }

    if (identity.id !== connection.identity.id) {
      // A different person on the same socket is not a refresh.
      const reason = 'That credential belongs to someone else.'
      this.#transport.close(connectionId, { code: Refusal.AUTH_REFUSED, message: reason })
      return fail(Refusal.AUTH_REFUSED, reason)
    }

    connection.identity = identity
    return done()
  }

  /** The heartbeat. Pushes out the TTL that stops ghosts standing in rooms. */
  async heartbeat(connectionId: string): Promise<Ack> {
    const connection = this.#connections.get(connectionId)
    if (!connection?.identity || !connection.officeId) {
      return fail(Refusal.NOT_AUTHENTICATED, 'Not in an office.')
    }
    await this.#store.touch(
      connection.officeId,
      connection.identity.id,
      connectionId,
      new Date(this.#now()).toISOString(),
    )
    return done()
  }

  /** A clean exit: the person pressed leave, or signed out. */
  async leaveOffice(connectionId: string): Promise<Ack> {
    const connection = this.#connections.get(connectionId)
    if (!connection?.identity || !connection.officeId) return done()
    await this.#endPresence(connection.officeId, connection.identity.id)
    return done()
  }

  /**
   * The socket closed.
   *
   * A device disconnecting never moves anybody: the person stays until their
   * last device is gone. What happens when the *last* one goes — the grace
   * period, and being shown to everyone else as reconnecting — is the
   * disconnect story's, and lands next.
   */
  async disconnected(connectionId: string): Promise<void> {
    const connection = this.#connections.get(connectionId)
    this.#connections.delete(connectionId)
    if (!connection?.identity || !connection.officeId) return

    const { id: userId } = connection.identity
    const officeId = connection.officeId

    const open = this.#byUser.get(userId)
    open?.delete(connectionId)
    if (open && open.size === 0) this.#byUser.delete(userId)

    const presence = await this.#store.get(officeId, userId)
    if (!presence) return

    const devices = presence.devices.filter((device) => device.connectionId !== connectionId)

    if (devices.length > 0) {
      await this.#store.put({ ...presence, devices })
      await this.#broadcast(officeId)
      return
    }

    await this.#endPresence(officeId, userId)
  }

  // ---------------------------------------------------------------- the office

  /**
   * The whole office, as this client should see it.
   *
   * Sent on entry so the map can render immediately, and again whenever
   * anything changes. The snapshot-and-diffs story makes that second half
   * cheaper; until there is something to diff, sending the whole thing is the
   * honest simple version.
   */
  async snapshot(connectionId: string): Promise<OfficeSnapshot> {
    const connection = this.#connections.get(connectionId)
    const officeId = connection?.officeId ?? this.#options.officeId
    const people = await this.#store.list(officeId)

    return {
      officeId,
      people: people.map((presence) => toPublic(presence)),
      you: {
        userId: connection?.identity?.id ?? '',
        deviceId: connection?.deviceId ?? '',
      },
    }
  }

  /**
   * The office as a plain object, for a host that wants to read it over HTTP.
   *
   * The same view the map gets. There is one way to ask what the office looks
   * like, and this is it.
   */
  async readOffice(): Promise<OfficeSnapshot> {
    return this.snapshot('')
  }

  // ------------------------------------------------------------------ helpers

  /** Tell everyone in the office what it looks like now. */
  async #broadcast(officeId: string): Promise<void> {
    const people = await this.#store.list(officeId)
    this.#transport.toOffice(officeId, 'office:state', {
      officeId,
      people: people.map((presence) => toPublic(presence)),
      you: { userId: '', deviceId: '' },
    })
  }

  #track(userId: string, connectionId: string): void {
    const open = this.#byUser.get(userId) ?? new Set<string>()
    open.add(connectionId)
    this.#byUser.set(userId, open)
  }

  /** End somebody's presence entirely and tell the office. */
  async #endPresence(officeId: string, userId: string): Promise<void> {
    const presence = await this.#store.get(officeId, userId)
    await this.#store.remove(officeId, userId)

    await this.#options.identity.onPresenceChanged?.({
      identity: { id: userId, displayName: presence?.displayName ?? '' },
      officeId,
      roomId: null,
    })

    await this.#broadcast(officeId)
    this.#logger.info('left office', { userId, officeId })
  }

  /** Something the host pushed in: revocation, or a new layout. */
  async #onHostEvent(event: HostEvent): Promise<void> {
    if (event.type === 'access.revoked') {
      // Immediate. The alternative is a socket that keeps working until its
      // credential expires, which is somebody still standing in a room they
      // have just been removed from.
      for (const connectionId of this.#byUser.get(event.userId) ?? []) {
        this.#transport.close(connectionId, {
          code: Refusal.ACCESS_REVOKED,
          message: event.reason,
        })
      }
      await this.#endPresence(this.#options.officeId, event.userId)
      return
    }

    if (event.type === 'template.changed') {
      this.#transport.toOffice(this.#options.officeId, 'template:changed', {
        officeId: this.#options.officeId,
      })
    }
  }

  /** Stop everything, so nothing outlives the server. */
  async close(): Promise<void> {
    this.#unsubscribe?.()
    this.#unsubscribe = null
  }
}

/**
 * Turn a stored record into what everyone else is allowed to see.
 *
 * The stored record carries raw device signals, connection ids and last-seen
 * timestamps. None of that is anybody else's business, and sending it would
 * mean broadcasting the whole office on every heartbeat.
 */
function toPublic(presence: Presence): PublicPresence {
  return {
    userId: presence.userId,
    displayName: presence.displayName,
    ...(presence.photoUrl ? { photoUrl: presence.photoUrl } : {}),
    roomId: presence.roomId,
    devices: presence.devices.map((device) => ({
      deviceId: device.deviceId,
      kind: device.kind,
    })),
    arrivedAt: presence.arrivedAt,
  }
}

/**
 * The room somebody lands in.
 *
 * A template always has exactly one reception, structurally rather than by
 * validation, so this cannot come back empty for a template that passed the
 * validator. The fallback is for the impossible case rather than a real one.
 */
function receptionOf(template: Template): Room {
  const reception = template.rooms.find((room) => room.type === 'reception')
  if (reception) return reception
  const first = template.rooms[0]
  if (!first) throw new Error('This template has no rooms at all.')
  return first
}
