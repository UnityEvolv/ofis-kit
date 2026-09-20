import type {
  ConnectionContext,
  EventBus,
  HostEvent,
  Identity,
  IdentityAdapter,
  TemplateSource,
} from '@unityevolv/ofiskit-adapters'
import {
  DISCONNECT_GRACE_MS,
  liveCustomStatus,
  resolveStatus,
  type CustomStatus,
  type DeviceKind,
  type ManualStatus,
  type Presence,
  type PresenceStore,
} from '@unityevolv/ofiskit-presence-store'
import type { Room, Template } from '@unityevolv/ofiskit-template'

import { Broadcaster, DIFF_WINDOW_MS } from './broadcast.js'
import { silentLogger, type Logger } from './logger.js'
import {
  Refusal,
  type Ack,
  type ActivityRequest,
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
  /**
   * How long somebody stays in their room after their last device drops.
   *
   * Thirty seconds covers a laptop sleeping, a train tunnel and a wifi handover
   * without anybody appearing to leave. Configurable because an end-to-end test
   * cannot wait thirty seconds to watch somebody disappear, and because a
   * flakier network may want longer.
   */
  graceMs?: number
  /**
   * How many people a room holds.
   *
   * An office setting rather than a template one, so the same layout serves a
   * two-person team and a forty-person one. The free office has no capacity at
   * all and returns null for everything.
   */
  roomCapacity?: (room: Room) => number | null
  /**
   * How long changes are gathered before they go out as one diff.
   *
   * Fifty milliseconds by default, which collapses a drag and nobody notices.
   * Configurable because a test wants to flush by hand rather than wait, and
   * because a very large office may prefer to trade a little latency for fewer
   * events.
   */
  diffWindowMs?: number
}

export class OfficeEngine {
  readonly #options: OfficeEngineOptions
  readonly #store: PresenceStore
  readonly #transport: Transport
  readonly #logger: Logger
  readonly #now: () => number
  readonly #broadcaster: Broadcaster

  readonly #connections = new Map<string, Connection>()
  /** userId → the connections that person has open. Presence is per user. */
  readonly #byUser = new Map<string, Set<string>>()
  /** userId → the timer that finishes removing them if nobody comes back. */
  readonly #graceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  #unsubscribe: (() => void) | null = null

  constructor(options: OfficeEngineOptions) {
    this.#options = options
    this.#store = options.store
    this.#transport = options.transport
    this.#logger = options.logger ?? silentLogger()
    this.#now = options.now ?? (() => Date.now())
    this.#broadcaster = new Broadcaster(
      options.store,
      options.transport,
      options.diffWindowMs ?? DIFF_WINDOW_MS,
    )

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

    // Back inside the grace period: cancel the removal and put them back where
    // they were, with no churn at all for anybody watching.
    this.#cancelGrace(identity.id)

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
          reconnectingUntil: null,
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

    // A rejoin is an update, not an arrival: the office already knows about
    // somebody who never appeared to leave, and announcing them again would
    // make a reconnect look like a person walking in.
    const seen = toPublic(presence, this.#now())
    this.#broadcaster.queue(
      officeId,
      existing
        ? { kind: 'person.updated', presence: seen }
        : { kind: 'person.entered', presence: seen },
    )

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
   * The socket closed, which is not the same as leaving.
   *
   * A dropped connection starts a grace period. The person stays in their room,
   * shown to everyone else as reconnecting, so a laptop sleeping for a moment
   * or a train going into a tunnel changes nothing visible. Only when nobody
   * comes back does the office get told they left.
   *
   * A device disconnecting never moves anybody, and never removes anybody who
   * still has another device open.
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
      // Another device is still there, so nothing about the person changed
      // except which screens they are on.
      const remaining = { ...presence, devices }
      await this.#store.put(remaining)
      this.#broadcaster.queue(officeId, {
        kind: 'person.updated',
        presence: toPublic(remaining, this.#now()),
      })
      return
    }

    const graceMs = this.#options.graceMs ?? DISCONNECT_GRACE_MS
    const until = new Date(this.#now() + graceMs).toISOString()

    const reconnecting = { ...presence, devices: [], reconnectingUntil: until }
    await this.#store.put(reconnecting)
    this.#broadcaster.queue(officeId, {
      kind: 'person.updated',
      presence: toPublic(reconnecting, this.#now()),
    })

    // An in-memory timer on the socket, with the store's TTL as the backstop
    // for a node that dies mid-timer. There is no scheduler anywhere.
    const timer = setTimeout(() => {
      this.#graceTimers.delete(userId)
      void this.#endPresence(officeId, userId)
    }, graceMs)
    timer.unref?.()
    this.#graceTimers.set(userId, timer)

    this.#logger.debug('connection dropped, grace started', { userId, officeId, connectionId })
  }

  // ------------------------------------------------------------------- moving

  /**
   * Move to a room.
   *
   * Two questions in a fixed order: may they (the adapter), and is there room.
   * **Nothing is reserved and nothing is held** — capacity is checked at the
   * moment of the move, so a room that filled while somebody was deciding
   * refuses them rather than squeezing them in.
   *
   * Every successful move is broadcast to the office; every refusal goes only
   * to whoever asked, with a reason they can be shown.
   */
  async joinRoom(connectionId: string, roomId: string): Promise<Ack> {
    const resolved = await this.#resolve(connectionId)
    if ('ok' in resolved) return resolved
    const { identity, officeId, presence } = resolved

    const template = await this.#options.templates.get(officeId)
    const room = template?.rooms.find((candidate) => candidate.id === roomId)
    if (!room) return fail(Refusal.ROOM_UNKNOWN, 'There is no such room.')

    if (presence.roomId === roomId) {
      return fail(Refusal.ROOM_ALREADY_THERE, `You are already in ${room.name}.`)
    }

    const permitted = await this.#options.identity.may({
      permission: 'join_room',
      identity,
      officeId,
      roomId,
    })
    if (!permitted.allowed) return fail(permitted.code, permitted.message)

    const capacity = this.#options.roomCapacity?.(room) ?? null
    if (capacity !== null) {
      const inside = await this.#store.listRoom(officeId, roomId)
      if (inside.length >= capacity) return fail(Refusal.ROOM_FULL, `${room.name} is full.`)
    }

    await this.#move(officeId, presence, roomId)
    return done()
  }

  /** Leave the room you are in, which puts you back in reception. */
  async leaveRoom(connectionId: string): Promise<Ack> {
    const resolved = await this.#resolve(connectionId)
    if ('ok' in resolved) return resolved
    const { officeId, presence } = resolved

    const template = await this.#options.templates.get(officeId)
    if (!template) return fail(Refusal.OFFICE_UNKNOWN, 'There is no office here.')

    const reception = receptionOf(template)
    if (presence.roomId === reception.id) return done()

    await this.#move(officeId, presence, reception.id)
    return done()
  }

  /** The move itself, once every rule has said yes. */
  async #move(officeId: string, presence: Presence, roomId: string): Promise<void> {
    const arrivedAt = new Date(this.#now()).toISOString()

    // Entering the break room is do not disturb, and leaving it clears that
    // again — unless the person chose a status for themselves, which survives.
    const moved = await this.#withBreakRoomStatus(
      officeId,
      { ...presence, roomId, arrivedAt },
      roomId,
      presence.roomId,
    )

    await this.#store.put(moved)

    // Almost always the small event. The exception is the break room, which
    // changes the status on the way in and back on the way out: a bare
    // `person.moved` carries no status, so that one move has to send the person.
    const at = this.#now()
    const statusChanged = resolveStatus(moved, at) !== resolveStatus(presence, at)
    this.#broadcaster.queue(
      officeId,
      statusChanged
        ? { kind: 'person.updated', presence: toPublic(moved, at) }
        : { kind: 'person.moved', userId: presence.userId, roomId, arrivedAt },
    )

    // The host is told, so unityofis can remember the last office and room on
    // the membership and put somebody back there next time they sign in.
    await this.#options.identity.onPresenceChanged?.({
      identity: { id: presence.userId, displayName: presence.displayName },
      officeId,
      roomId,
    })

    this.#logger.debug('moved', { userId: presence.userId, officeId, roomId })
  }

  // ------------------------------------------------------------------- status

  /**
   * A status the person chose. It outranks everything automatic until cleared.
   *
   * Marked as their own, so the break room neither overwrites it on the way in
   * nor clears it on the way out. Without that distinction, stepping into the
   * break room once would pin somebody to do not disturb for the rest of the
   * day, because afterwards there is no way to tell the two apart.
   */
  async setManualStatus(connectionId: string, manual: ManualStatus | null): Promise<Ack> {
    const resolved = await this.#resolve(connectionId)
    if ('ok' in resolved) return resolved
    const { officeId, presence } = resolved

    if (manual !== null && !['available', 'away', 'dnd'].includes(manual)) {
      return fail(Refusal.MALFORMED, 'That is not a status.')
    }

    const chosen: Presence = {
      ...presence,
      manual,
      manualFrom: manual === null ? null : 'user',
    }
    await this.#store.put(chosen)
    this.#broadcaster.queue(officeId, {
      kind: 'person.updated',
      presence: toPublic(chosen, this.#now()),
    })
    return done()
  }

  /**
   * A custom status: a few words, maybe an emoji, and when it stops being true.
   *
   * The expiry arrives as an absolute instant worked out by the client. Where
   * "today" and "this week" land depends on the viewer's time zone, and the
   * server never computes a date in anybody's zone — it only compares two
   * instants, which is also why nothing has to run to clear it.
   */
  async setCustomStatus(connectionId: string, custom: CustomStatus | null): Promise<Ack> {
    const resolved = await this.#resolve(connectionId)
    if ('ok' in resolved) return resolved
    const { officeId, presence } = resolved

    if (custom !== null) {
      if (typeof custom.text !== 'string' || custom.text.trim().length === 0) {
        return fail(Refusal.MALFORMED, 'A custom status needs some words.')
      }
      if (custom.text.length > 100) {
        return fail(Refusal.MALFORMED, 'A custom status is at most a hundred characters.')
      }
      if (custom.expiresAt !== undefined && Number.isNaN(Date.parse(custom.expiresAt))) {
        return fail(Refusal.MALFORMED, 'That expiry is not a date.')
      }
    }

    const said: Presence = { ...presence, custom }
    await this.#store.put(said)
    this.#broadcaster.queue(officeId, {
      kind: 'person.updated',
      presence: toPublic(said, this.#now()),
    })
    return done()
  }

  /**
   * What this device is doing: idle, or backgrounded.
   *
   * One device's signal, never a conclusion about the person. Resolving across
   * every device they have open is the presence store's job, and it is why
   * typing on a phone keeps somebody available while their laptop sits idle.
   */
  async setActivity(connectionId: string, activity: ActivityRequest): Promise<void> {
    const connection = this.#connections.get(connectionId)
    if (!connection?.identity || !connection.officeId) return

    const presence = await this.#store.get(connection.officeId, connection.identity.id)
    if (!presence) return

    const devices = presence.devices.map((device) =>
      device.connectionId === connectionId
        ? { ...device, idle: Boolean(activity?.idle), foreground: activity?.foreground !== false }
        : device,
    )

    const at = this.#now()
    const active: Presence = { ...presence, devices }
    const before = resolveStatus(presence, at)
    const after = resolveStatus(active, at)
    await this.#store.put(active)

    // Only tell the office when the answer actually changed. Idle flags arrive
    // constantly and almost none of them mean anything to anybody else — which
    // matters more now that a change costs an event rather than being swept up
    // by the next full broadcast.
    if (before !== after) {
      this.#broadcaster.queue(connection.officeId, {
        kind: 'person.updated',
        presence: toPublic(active, at),
      })
    }
  }

  /**
   * Entering the break room is do not disturb; leaving it clears that again.
   *
   * Deliberately not a manual status: one the person chose survives walking in
   * and out of the break room, because they meant it.
   */
  async #withBreakRoomStatus(
    officeId: string,
    presence: Presence,
    to: string,
    from: string,
  ): Promise<Presence> {
    const template = await this.#options.templates.get(officeId)
    const breakRoom = template?.rooms.find((room) => room.type === 'break')
    if (!breakRoom) return presence

    if (presence.manualFrom === 'user') return presence

    if (to === breakRoom.id) return { ...presence, manual: 'dnd', manualFrom: 'room' }
    if (from === breakRoom.id && presence.manualFrom === 'room') {
      // Only what the room set gets cleared on the way out.
      return { ...presence, manual: null, manualFrom: null }
    }
    return presence
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

    // Deliberately *not* flushed first. Flushing would make the snapshot exactly
    // the state after `seq` — tidier to describe, and it would mean firing a
    // full office diff every time anybody walked in, which is the coalescing
    // this story exists to do, undone.
    //
    // So a snapshot is "everything up to `seq`, and possibly a little more": the
    // store already has changes the office has not been told about, and the diff
    // that follows restates them. Every change is idempotent by construction —
    // entered and updated set a person, moved sets their room, left removes
    // somebody who may already be gone — so the client applies it to no effect.
    const [people, seq] = await Promise.all([
      this.#store.list(officeId),
      this.#store.currentSequence(officeId),
    ])
    const at = this.#now()

    return {
      officeId,
      seq,
      people: people.map((presence) => toPublic(presence, at)),
      you: {
        userId: connection?.identity?.id ?? '',
        deviceId: connection?.deviceId ?? '',
      },
    }
  }

  /**
   * A client noticed a gap and wants the whole office again.
   *
   * The only thing that ever re-sends it, and the reason a missed diff is a
   * recoverable hiccup rather than a screen that stays wrong until somebody
   * reloads. It costs a full send, which is exactly why a client asks for it
   * rather than being given one.
   */
  async resync(connectionId: string): Promise<Ack<{ snapshot: OfficeSnapshot }>> {
    const resolved = await this.#resolve(connectionId)
    if ('ok' in resolved) return resolved
    return { ok: true, snapshot: await this.snapshot(connectionId) }
  }

  /**
   * Send every pending diff immediately.
   *
   * For shutdown, and for a test that would rather not wait out the window.
   */
  async flush(officeId: string = this.#options.officeId): Promise<void> {
    await this.#broadcaster.flush(officeId)
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

  /**
   * Resolve a connection to everything a handler needs, or the refusal.
   *
   * Every action funnels through here, so "you are not signed in" and "you are
   * not in the office" are answered once with one code each, rather than in
   * fourteen slightly different ways across fourteen handlers.
   */
  async #resolve(
    connectionId: string,
  ): Promise<Refused | { identity: Identity; officeId: string; presence: Presence }> {
    const connection = this.#connections.get(connectionId)
    if (!connection?.identity || !connection.officeId) {
      return fail(Refusal.NOT_AUTHENTICATED, 'Enter the office first.')
    }
    const presence = await this.#store.get(connection.officeId, connection.identity.id)
    if (!presence) return fail(Refusal.NOT_PRESENT, 'You are not in the office.')

    return { identity: connection.identity, officeId: connection.officeId, presence }
  }

  /** Somebody came back, or left cleanly. Either way, stop the removal. */
  #cancelGrace(userId: string): void {
    const timer = this.#graceTimers.get(userId)
    if (timer) {
      clearTimeout(timer)
      this.#graceTimers.delete(userId)
    }
  }

  #track(userId: string, connectionId: string): void {
    const open = this.#byUser.get(userId) ?? new Set<string>()
    open.add(connectionId)
    this.#byUser.set(userId, open)
  }

  /** End somebody's presence entirely and tell the office. */
  async #endPresence(officeId: string, userId: string): Promise<void> {
    this.#cancelGrace(userId)
    const presence = await this.#store.get(officeId, userId)
    await this.#store.remove(officeId, userId)

    await this.#options.identity.onPresenceChanged?.({
      identity: { id: userId, displayName: presence?.displayName ?? '' },
      officeId,
      roomId: null,
    })

    this.#broadcaster.queue(officeId, { kind: 'person.left', userId })
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
    // Everything pending goes out first. A diff lost to shutdown leaves every
    // client that was connected holding state one event behind, and they would
    // only find out on the next change.
    await this.#broadcaster.flush(this.#options.officeId)
    this.#broadcaster.dispose()
    for (const timer of this.#graceTimers.values()) clearTimeout(timer)
    this.#graceTimers.clear()
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
function toPublic(presence: Presence, at: number = Date.now()): PublicPresence {
  const custom = liveCustomStatus(presence, at)

  return {
    userId: presence.userId,
    displayName: presence.displayName,
    ...(presence.photoUrl ? { photoUrl: presence.photoUrl } : {}),
    roomId: presence.roomId,
    // Resolved here so every client renders the same answer, rather than each
    // working it out from the raw device signals — which they cannot see, and
    // should not have to.
    status: resolveStatus(presence, at),
    ...(custom ? { custom } : {}),
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
