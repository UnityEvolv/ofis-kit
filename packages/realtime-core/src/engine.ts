import type {
  ConnectionContext,
  EventBus,
  HostEvent,
  Identity,
  IdentityAdapter,
  RateLimiter,
  TemplateSource,
} from '@unityevolv/ofiskit-adapters'
import {
  DISCONNECT_GRACE_MS,
  liveCustomStatus,
  resolveStatus,
  suppressesInterruption,
  type CustomStatus,
  type DeviceKind,
  type ManualStatus,
  type Presence,
  type PresenceStore,
} from '@unityevolv/ofiskit-presence-store'
import { hostsCalls, newId, type Room, type Template } from '@unityevolv/ofiskit-template'

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
 * Connecting, authenticating, arriving, leaving, moving, status, and locking a
 * room against interruption. Calls arrive with their own story, as a handler
 * added here rather than a change to what is already written.
 */

const fail = (code: string, message: string): Refused => ({ ok: false, code, message })
const done = (): Ack => ({ ok: true })

/**
 * How long a knock waits before it gives up.
 *
 * A minute: long enough for somebody to finish a sentence and look, short
 * enough that a knock nobody answered stops sitting on the screen. It expires on
 * its own, so ignoring a knock is a complete answer and needs no button.
 */
const KNOCK_TTL_MS = 60_000

/**
 * Five knocks a minute, per person per room.
 *
 * Not a security limit — it is about the room. A knock interrupts everyone in
 * it, so somebody knocking twelve times is not being persistent, they are making
 * the room unusable.
 */
const KNOCK_LIMIT = 5
const KNOCK_WINDOW_MS = 60_000

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
   * How often somebody may knock.
   *
   * Required rather than defaulted, because a limiter the engine invented for
   * itself would be a counter per process, and a product on four nodes would
   * quietly have four times the limit it configured. The free office passes the
   * in-memory one; unityofis passes its own.
   */
  limiter: RateLimiter
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
  /**
   * How long a knock waits.
   *
   * Configurable for the same reason as the grace period: an end-to-end test
   * cannot sit through a minute to watch a knock expire.
   */
  knockTtlMs?: number
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
  /** knockId → the timer that gives up on it. In memory, like everything else. */
  readonly #knockTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /**
   * Who has been let into a locked room.
   *
   * One-shot, and spent by the move it authorises: an admission is permission to
   * come in now, not a standing key to the room. Deliberately not in the
   * presence store — it lives for the few seconds between being let in and
   * walking in, and a node that dies in that window is a person who knocks
   * again, which is the right outcome.
   */
  readonly #admissions = new Set<string>()
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

    // The lock, and the one thing that gets past it. `#wasAdmitted` is spent by
    // asking: an admission lets one person in once, and does not survive into a
    // second attempt or into anybody else's.
    const locked = (await this.#store.locks(officeId)).some((lock) => lock.roomId === roomId)
    if (locked && !this.#wasAdmitted(officeId, roomId, identity.id)) {
      return fail(Refusal.ROOM_LOCKED, `${room.name} is locked. Knock to ask to come in.`)
    }

    // Capacity last, and deliberately after the admission is spent: an
    // invitation is not a reservation, so somebody let into a room that filled
    // while they were reaching for the door is refused and stays where they are.
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
    // Read before the move, because afterwards the lock may already be gone.
    const leftLocked = await this.#isLocked(officeId, presence.roomId)

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

    // Walking out is one of the ways a room empties, so it is one of the ways a
    // lock clears.
    await this.#unlockIfEmptied(officeId, presence.roomId, leftLocked)

    // The host is told, so unityofis can remember the last office and room on
    // the membership and put somebody back there next time they sign in.
    await this.#options.identity.onPresenceChanged?.({
      identity: { id: presence.userId, displayName: presence.displayName },
      officeId,
      roomId,
    })

    this.#logger.debug('moved', { userId: presence.userId, officeId, roomId })
  }

  // ------------------------------------------------------- lock, knock, admit

  /**
   * Close a room to interruption.
   *
   * Anyone inside can lock it, not only an administrator: the people in the
   * conversation are the ones who know it should not be interrupted, and making
   * this an admin power would mean asking permission to have a private
   * conversation. Guests cannot, which is an adapter question rather than a rule
   * here — this app has no guests and its adapter says yes.
   */
  async lock(connectionId: string, roomId: string): Promise<Ack> {
    const resolved = await this.#resolve(connectionId)
    if ('ok' in resolved) return resolved
    const { identity, officeId, presence } = resolved

    const template = await this.#options.templates.get(officeId)
    const room = template?.rooms.find((candidate) => candidate.id === roomId)
    if (!room) return fail(Refusal.ROOM_UNKNOWN, 'There is no such room.')

    // Reception and the break room are open by design, and a lockable reception
    // would be a way to lock everybody out of the office.
    if (!hostsCalls(room.type)) {
      return fail(
        Refusal.ROOM_NOT_LOCKABLE,
        `${room.name} is open to everyone and cannot be locked.`,
      )
    }
    if (presence.roomId !== roomId) {
      return fail(Refusal.ROOM_NOT_INSIDE, 'Only somebody in the room can lock it.')
    }

    const permitted = await this.#options.identity.may({
      permission: 'lock_room',
      identity,
      officeId,
      roomId,
    })
    if (!permitted.allowed) return fail(permitted.code, permitted.message)

    // The store returns the lock either way, so a second person pressing lock is
    // told who holds it rather than being refused for no visible reason.
    const lock = await this.#store.lock(officeId, {
      roomId,
      lockedBy: identity.id,
      lockedAt: new Date(this.#now()).toISOString(),
    })
    this.#broadcaster.queue(officeId, { kind: 'room.locked', roomId, lockedBy: lock.lockedBy })
    this.#logger.debug('room locked', { officeId, roomId, userId: identity.id })
    return done()
  }

  /** Open it again. Anyone inside, not only whoever locked it. */
  async unlock(connectionId: string, roomId: string): Promise<Ack> {
    const resolved = await this.#resolve(connectionId)
    if ('ok' in resolved) return resolved
    const { officeId, presence } = resolved

    if (presence.roomId !== roomId) {
      return fail(Refusal.ROOM_NOT_INSIDE, 'Only somebody in the room can unlock it.')
    }

    await this.#store.unlock(officeId, roomId)
    this.#broadcaster.queue(officeId, { kind: 'room.unlocked', roomId })
    return done()
  }

  /**
   * Ask to come into a locked room.
   *
   * Everyone inside is told. Anyone inside on do not disturb is told silently,
   * with no sound and no notification, and the knocker is told that is why it
   * may go unanswered — otherwise an ignored knock is indistinguishable from a
   * broken one. Nothing is refused: do not disturb suppresses interruption, not
   * access.
   */
  async knock(
    connectionId: string,
    roomId: string,
  ): Promise<Ack<{ knockId: string; silent: boolean }>> {
    const resolved = await this.#resolve(connectionId)
    if ('ok' in resolved) return resolved
    const { identity, officeId, presence } = resolved

    const template = await this.#options.templates.get(officeId)
    const room = template?.rooms.find((candidate) => candidate.id === roomId)
    if (!room) return fail(Refusal.ROOM_UNKNOWN, 'There is no such room.')
    if (presence.roomId === roomId) {
      return fail(Refusal.KNOCK_INSIDE, 'You are already in this room.')
    }

    const locked = (await this.#store.locks(officeId)).some((lock) => lock.roomId === roomId)
    if (!locked) {
      return fail(Refusal.KNOCK_NOT_LOCKED, `${room.name} is not locked. You can walk in.`)
    }

    const permitted = await this.#options.identity.may({
      permission: 'knock',
      identity,
      officeId,
      roomId,
    })
    if (!permitted.allowed) return fail(permitted.code, permitted.message)

    // Per person per room, because the limit is about not making one room
    // unusable and has nothing to say about knocking on a different door.
    const verdict = await this.#options.limiter.take(
      `knock:${identity.id}:${roomId}`,
      KNOCK_LIMIT,
      KNOCK_WINDOW_MS,
    )
    if (!verdict.allowed) {
      const seconds = Math.ceil(verdict.retryAfterMs / 1000)
      return fail(
        Refusal.KNOCK_RATE_LIMITED,
        `You have knocked a few times already. Try again in ${seconds} seconds.`,
      )
    }

    const at = this.#now()
    const ttl = this.#options.knockTtlMs ?? KNOCK_TTL_MS
    const knock = {
      id: newId(),
      roomId,
      userId: identity.id,
      displayName: identity.displayName,
      ...(identity.photoUrl ? { photoUrl: identity.photoUrl } : {}),
      createdAt: new Date(at).toISOString(),
      expiresAt: new Date(at + ttl).toISOString(),
    }
    // Replaces any earlier knock from this person on this room. Knocking again
    // is impatience, not a second request, and two rows would mean two cards on
    // the screen of everyone inside.
    await this.#store.knock(officeId, knock)

    // Per person rather than to the room, because `silent` differs between two
    // people standing in the same room.
    const inside = await this.#store.listRoom(officeId, roomId)
    let silentForEveryone = inside.length > 0
    for (const person of inside) {
      const silent = suppressesInterruption(person, at)
      if (!silent) silentForEveryone = false
      this.#transport.toUser(person.userId, 'knock:received', {
        knockId: knock.id,
        roomId,
        userId: knock.userId,
        displayName: knock.displayName,
        ...(knock.photoUrl ? { photoUrl: knock.photoUrl } : {}),
        silent,
        expiresAt: knock.expiresAt,
      })
    }

    // An in-memory timer on the socket, with the store's own expiry as the
    // backstop for a node that dies mid-timer. There is still no scheduler.
    const timer = setTimeout(() => {
      this.#knockTimers.delete(knock.id)
      void this.#expireKnock(officeId, knock.id, knock.userId)
    }, ttl)
    timer.unref?.()
    this.#knockTimers.set(knock.id, timer)

    this.#logger.debug('knocked', { officeId, roomId, userId: identity.id })
    return { ok: true, knockId: knock.id, silent: silentForEveryone }
  }

  /**
   * Let one person in, without unlocking the room for anybody else.
   *
   * Which is the whole point of admitting rather than unlocking: the
   * conversation stays closed, and one person joins it.
   */
  async admit(connectionId: string, knockId: string): Promise<Ack> {
    const resolved = await this.#resolve(connectionId)
    if ('ok' in resolved) return resolved
    const { identity, officeId, presence } = resolved

    // Looked up within the room this person is standing in, so answering a knock
    // is only ever possible for a knock on your own door.
    const knock = (await this.#store.knocks(officeId, presence.roomId)).find(
      (candidate) => candidate.id === knockId,
    )
    if (!knock) return fail(Refusal.KNOCK_UNKNOWN, 'That knock is no longer waiting.')

    await this.#store.clearKnock(officeId, knockId)
    this.#clearKnockTimer(knockId)
    this.#admissions.add(admissionKey(officeId, knock.roomId, knock.userId))

    this.#transport.toUser(knock.userId, 'knock:admitted', {
      roomId: knock.roomId,
      byUserId: identity.id,
    })
    // Everyone inside, so the card disappears from every screen rather than only
    // from the screen of whoever happened to press the button.
    this.#transport.toRoom(officeId, knock.roomId, 'knock:resolved', {
      knockId,
      outcome: 'admitted',
      byUserId: identity.id,
    })
    return done()
  }

  /**
   * Say no.
   *
   * Declining and ignoring end the same way for the knocker; the difference is
   * that declining is immediate. Ignoring is a complete answer too, which is why
   * a knock expires on its own.
   */
  async decline(connectionId: string, knockId: string): Promise<Ack> {
    const resolved = await this.#resolve(connectionId)
    if ('ok' in resolved) return resolved
    const { identity, officeId, presence } = resolved

    const knock = (await this.#store.knocks(officeId, presence.roomId)).find(
      (candidate) => candidate.id === knockId,
    )
    if (!knock) return fail(Refusal.KNOCK_UNKNOWN, 'That knock is no longer waiting.')

    await this.#store.clearKnock(officeId, knockId)
    this.#clearKnockTimer(knockId)

    this.#transport.toUser(knock.userId, 'knock:resolved', { knockId, outcome: 'declined' })
    this.#transport.toRoom(officeId, knock.roomId, 'knock:resolved', {
      knockId,
      outcome: 'declined',
      byUserId: identity.id,
    })
    return done()
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
    const [people, locks, seq] = await Promise.all([
      this.#store.list(officeId),
      this.#store.locks(officeId),
      this.#store.currentSequence(officeId),
    ])
    const at = this.#now()

    return {
      officeId,
      seq,
      people: people.map((presence) => toPublic(presence, at)),
      locks: locks.map((lock) => ({ roomId: lock.roomId, lockedBy: lock.lockedBy })),
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

  /**
   * Was this person let in, and spend the admission if so.
   *
   * Synchronous and destructive on purpose: asking is what spends it. An
   * admission that survived being asked about would be a key to the room rather
   * than an invitation to come in now.
   */
  #wasAdmitted(officeId: string, roomId: string, userId: string): boolean {
    const key = admissionKey(officeId, roomId, userId)
    if (!this.#admissions.has(key)) return false
    this.#admissions.delete(key)
    return true
  }

  /**
   * A room that has just emptied unlocks itself, and the office is told.
   *
   * The store drops the lock on a room nobody is in, however it emptied — a
   * clean exit, a closed tab, a crashed browser, or a connection that dropped and
   * never came back. Without this, a browser crash leaves a room locked with
   * nobody inside and nobody able to get in.
   *
   * `wasLocked` has to be read before the person is moved or removed, and it is
   * not decoration: without it every departure from every room announces an
   * unlock, and a client cannot tell that from a door that really did just open.
   */
  async #isLocked(officeId: string, roomId: string): Promise<boolean> {
    return (await this.#store.locks(officeId)).some((lock) => lock.roomId === roomId)
  }

  async #unlockIfEmptied(officeId: string, roomId: string, wasLocked: boolean): Promise<void> {
    if (!wasLocked) return
    // Reading the locks prunes the ones whose rooms are empty, so this answers
    // "did that departure empty the room" without counting anybody here.
    if (await this.#isLocked(officeId, roomId)) return

    const knocks = await this.#store.knocks(officeId, roomId)
    for (const knock of knocks) {
      await this.#store.clearKnock(officeId, knock.id)
      this.#clearKnockTimer(knock.id)
      // There is nobody left to answer, and the room is open now anyway.
      this.#transport.toUser(knock.userId, 'knock:resolved', {
        knockId: knock.id,
        outcome: 'expired',
      })
    }

    this.#broadcaster.queue(officeId, { kind: 'room.unlocked', roomId })
  }

  /** A knock nobody answered. Ignoring one is a complete answer. */
  async #expireKnock(officeId: string, knockId: string, userId: string): Promise<void> {
    await this.#store.clearKnock(officeId, knockId)
    this.#transport.toUser(userId, 'knock:resolved', { knockId, outcome: 'expired' })
  }

  #clearKnockTimer(knockId: string): void {
    const timer = this.#knockTimers.get(knockId)
    if (timer) {
      clearTimeout(timer)
      this.#knockTimers.delete(knockId)
    }
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
    // Before the removal, because afterwards the store has already dropped the
    // lock and there is no way to tell that this is what did it.
    const leftLocked = presence ? await this.#isLocked(officeId, presence.roomId) : false

    await this.#store.remove(officeId, userId)

    // However they went — a clean exit, a closed tab, a crashed browser, or a
    // connection that dropped and never came back — a room is never left locked
    // with nobody in it.
    if (presence) await this.#unlockIfEmptied(officeId, presence.roomId, leftLocked)

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
    for (const timer of this.#knockTimers.values()) clearTimeout(timer)
    this.#knockTimers.clear()
    this.#admissions.clear()
    this.#unsubscribe?.()
    this.#unsubscribe = null
  }
}

/**
 * One admission: this person, this room, this office.
 *
 * All three, because an admission to one room says nothing about another, and in
 * unityofis somebody may be admitted to a room in one office while standing in
 * a different one.
 */
const admissionKey = (officeId: string, roomId: string, userId: string): string =>
  `${officeId}:${roomId}:${userId}`

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
