import type {
  ConnectionContext,
  Decision,
  EventBus,
  FollowChange,
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
import {
  hostsCalls,
  isLockable,
  newId,
  type Room,
  type Template,
} from '@unityevolv/ofiskit-template'

import { Broadcaster, DIFF_WINDOW_MS } from './broadcast.js'
import { CallRegistry, type CallHooks, type CallLeg, type RtcServerPlugin } from './calls.js'
import { FOLLOW_DEFAULTS, FollowBook, type FollowOptions } from './follow.js'
import { silentLogger, type Logger } from './logger.js'
import { NUDGE_DEFAULTS, cleanNudgeLine, nudgeDelivery, type NudgeOptions } from './nudge.js'
import {
  REACTIONS,
  Refusal,
  type Ack,
  type ActivityRequest,
  type CallJoinRequest,
  type CallJoinResponse,
  type EnterOfficeRequest,
  type FollowEndReason,
  type MediaStateRequest,
  type NudgeDelivery,
  type NudgeRequest,
  type OfficeSnapshot,
  type PublicPresence,
  type SignalMessage,
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

const fail = (code: string, message: string, fields?: Record<string, string>): Refused => ({
  ok: false,
  code,
  message,
  ...(fields ? { fields } : {}),
})
const done = (): Ack => ({ ok: true })
/** Whole seconds to wait, for a sentence. */
const seconds = (ms: number): number => Math.ceil(ms / 1000)
/** An adapter's "no", passed on whole — including any fields it carries, such as a return date. */
const refusedBy = (decision: Extract<Decision, { allowed: false }>): Refused =>
  fail(decision.code, decision.message, decision.fields)

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

/**
 * Six reactions in ten seconds, per person.
 *
 * Also not a security limit. A reaction floats over somebody's face for a few
 * seconds, so a held key is a screen nobody else can read — and the person doing
 * it usually has no idea. Per person rather than per room, because the thing
 * being limited is one person's enthusiasm and not the room's total.
 */
const REACTION_LIMIT = 6
const REACTION_WINDOW_MS = 10_000

/**
 * How long somebody may talk with their hand up before it comes down.
 *
 * The hand means "I would like to speak". Once you are speaking, it has done its
 * job, and leaving it up makes the queue a lie. Three seconds rather than
 * instantly, because a two-word interjection while somebody else finishes is not
 * your turn.
 */
const HAND_LOWER_AFTER_MS = 3_000

/**
 * How long an admission waits to be used.
 *
 * As long as a knock does, and for the same reason: it is an invitation to come
 * in now, and an invitation nobody took up a minute later is not one anybody
 * inside remembers giving.
 */
const ADMISSION_TTL_MS = 60_000

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
   * Who carries the media.
   *
   * The server half of the provider interface. The free office passes the
   * built-in peer-to-peer one and has no other; a host with an SFU passes its
   * plugin and changes nothing else, which is the property the interface exists
   * to have.
   */
  provider: RtcServerPlugin
  /**
   * Where a host attaches call records, usage and cost.
   *
   * Unbound here: the free office has no database to write a record to, and the
   * whole mechanism costs nothing when nobody is listening. None of these hooks
   * can refuse anything — a hook that could say no would be a permission check
   * hiding outside the identity adapter.
   */
  callHooks?: CallHooks
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
  /**
   * How long somebody may speak with their hand up before it comes down.
   *
   * Configurable for the same reason as the other two: a test should not have to
   * sit through three seconds of somebody talking to watch a hand drop.
   */
  handLowerAfterMs?: number
  /**
   * How many people the office holds at once. Null or absent means no ceiling.
   *
   * Checked at the door and nowhere else: somebody already inside coming back on
   * a second device or after a reload is never counted twice, and nobody is ever
   * removed to make the number true. The public demo sets it so that a link
   * anybody can open does not become free conferencing for whoever finds it.
   */
  maxPresent?: number | null
  /**
   * How often somebody may nudge: per person and overall. Anything left out takes
   * its default from `NUDGE_DEFAULTS` — three a minute to one person, ten a minute
   * overall. Counted by `limiter`, so a host on many nodes has one budget.
   */
  nudge?: Partial<NudgeOptions>
  /**
   * The limits of following. Anything left out takes its default from
   * `FOLLOW_DEFAULTS` — five followers per person, ten minutes before a declined
   * asker may ask again.
   */
  follow?: Partial<FollowOptions>
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
   * deviceId → the timer that lowers a raised hand because its owner is talking.
   *
   * A timer on the connection rather than anything swept: a hand belongs to a leg
   * in a call, and a leg cannot outlive the socket holding it. That is the same
   * rule as the knock timers and the grace period, and it is why there is no
   * scheduler anywhere in this repository.
   */
  readonly #handTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /**
   * Who has been let into a locked room, by somebody inside answering a knock
   * or by the host through `admitUser`.
   *
   * One-shot, and spent by the move it authorises: an admission is permission to
   * come in now, not a standing key to the room. Deliberately not in the
   * presence store — it lives for the few seconds between being let in and
   * walking in, and a node that dies in that window is a person who knocks
   * again, which is the right outcome.
   *
   * Keyed by office, room and person, and holding who it is for and when it
   * stops counting: an admission nobody used is gone after a minute, and gone at
   * once when its person leaves the office, so walking back in tomorrow is not
   * walking past a lock on the strength of yesterday's knock.
   */
  readonly #admissions = new Map<string, { userId: string; expiresAt: number }>()
  /** The calls happening right now, which are not presence and never merged into it. */
  readonly #calls: CallRegistry
  /**
   * Who follows whom. In memory, like admissions: a link between two people that
   * dies with either of them. Kept the same on every node by publishing each
   * change on the host bus.
   */
  readonly #follows: FollowBook
  /**
   * The timers following needs: a request lapsing, and a move giving up on a
   * follower's call. On the node that started them, with expiry also checked at
   * the moment of use for a node that never fires them.
   */
  readonly #followTimers = new Map<string, ReturnType<typeof setTimeout>>()
  readonly #nudgeLimits: NudgeOptions
  readonly #followLimits: FollowOptions
  #unsubscribe: (() => void) | null = null

  constructor(options: OfficeEngineOptions) {
    this.#options = options
    this.#store = options.store
    this.#transport = options.transport
    this.#logger = options.logger ?? silentLogger()
    this.#now = options.now ?? (() => Date.now())
    this.#follows = new FollowBook(this.#now)
    this.#nudgeLimits = { ...NUDGE_DEFAULTS, ...definedOnly(options.nudge) }
    this.#followLimits = { ...FOLLOW_DEFAULTS, ...definedOnly(options.follow) }
    this.#broadcaster = new Broadcaster(
      options.store,
      options.transport,
      options.diffWindowMs ?? DIFF_WINDOW_MS,
    )
    this.#calls = new CallRegistry(options.provider, options.callHooks ?? {}, this.#now)

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

    // The client chooses its own device id, and everything per-screen is found by
    // it: signalling, call legs, the share slot. Letting a second person stand on
    // an id somebody else is using would hand them that person's leg and route
    // that person's offers to them, so it is refused here, before anything is
    // keyed by it.
    if (await this.#deviceHeldByAnother(officeId, connection.deviceId, identity.id)) {
      return fail(
        Refusal.DEVICE_IN_USE,
        'This device is already in the office as somebody else. Try again in a moment.',
      )
    }

    // The ceiling, at the door and only for somebody new: a reload, a second
    // device or a reconnect is somebody already counted.
    const ceiling = this.#options.maxPresent ?? null
    if (ceiling !== null && !(await this.#store.get(officeId, identity.id))) {
      const present = await this.#store.list(officeId)
      if (present.length >= ceiling) {
        return fail(Refusal.OFFICE_FULL, 'The office is full right now. Try again in a while.')
      }
    }

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
          ...externalOf(identity),
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
          ...externalOf(identity),
          devices: [device],
          inCall: false,
          enteredAt: at,
          arrivedAt: at,
        }

    await this.#store.put(presence)

    // A rejoin is an update, not an arrival: the office already knows about
    // somebody who never appeared to leave, and announcing them again would
    // make a reconnect look like a person walking in.
    const seen = this.#public(presence, this.#now())
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

    // A socket the record no longer mentions was already replaced — the same
    // device came back on a new one before this one was noticed dying — so its
    // going changes nothing, and must not start a grace period over the top of a
    // person who is plainly here.
    if (devices.length === presence.devices.length) return

    if (devices.length > 0) {
      /*
       * Another device is still there, so nothing about the person changed except
       * which screens they are on — but this screen's call leg goes, because there
       * is nothing behind it any more.
       *
       * Unless this screen is still there. A reload or a network handover opens
       * the new socket before the old one is noticed dying, and the new one has
       * the same device id and has already taken over its leg; ending that leg
       * here would hang up on somebody for having reconnected.
       */
      const sameScreen =
        devices.some((device) => device.deviceId === connection.deviceId) ||
        this.#hasOpenConnection(userId, connection.deviceId)

      const remaining = { ...presence, devices }
      await this.#store.put(remaining)
      this.#broadcaster.queue(officeId, {
        kind: 'person.updated',
        presence: this.#public(remaining, this.#now()),
      })

      if (!sameScreen) {
        await this.#leaveCallLeg(officeId, presence.roomId, connection.deviceId)
        // Whether they are still in a call now depends on whether the leg that
        // went was their last one, and the record has to say so or they are shown
        // in a call for as long as they stay in the room.
        await this.#refreshInCall(officeId, userId, presence.roomId)
      }
      return
    }

    const graceMs = this.#options.graceMs ?? DISCONNECT_GRACE_MS
    const until = new Date(this.#now() + graceMs).toISOString()

    /*
     * The call leg keeps its seat while the connection is away.
     *
     * A device that drops mid-call and comes back within the grace period rejoins
     * in the state it left — same mute, same camera — and the seat being held is
     * what stops the room filling past somebody who is still on their way back.
     * The share is not restored: it belonged to a screen that is no longer there.
     * It is given up here rather than when they come back, because the slot would
     * otherwise be held by a device that has stopped sending — a frozen last frame
     * on everybody's screen, or nothing at all, for the length of the grace period.
     */
    this.#calls.releaseShare(officeId, presence.roomId, connection.deviceId)
    this.#calls.hold(officeId, presence.roomId, connection.deviceId, until)
    this.#announceCall(officeId, presence.roomId)

    const reconnecting = { ...presence, devices: [], reconnectingUntil: until }
    await this.#store.put(reconnecting)
    this.#broadcaster.queue(officeId, {
      kind: 'person.updated',
      presence: this.#public(reconnecting, this.#now()),
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

    const refused = await this.#entryRefusal(officeId, identity, room)
    if (refused) return refused

    await this.#move(officeId, presence, roomId)
    // Walking somewhere by yourself while following somebody stops the follow,
    // because that is obviously what was meant.
    this.#endFollowing(identity.id, 'moved_away')
    return done()
  }

  /**
   * Whether this person may walk into this room now, or the refusal.
   *
   * The same three questions for a move somebody makes and a move following makes
   * for them, so a follower is never pushed through a door they could not open
   * themselves. Asked in a fixed order: may they (the adapter), is it locked, is
   * there room.
   */
  async #entryRefusal(officeId: string, identity: Identity, room: Room): Promise<Refused | null> {
    const permitted = await this.#options.identity.may({
      permission: 'join_room',
      identity,
      officeId,
      roomId: room.id,
    })
    if (!permitted.allowed) return refusedBy(permitted)

    // The lock, and the one thing that gets past it. `#wasAdmitted` is spent by
    // asking: an admission lets one person in once, and does not survive into a
    // second attempt or into anybody else's.
    const locked = (await this.#store.locks(officeId)).some((lock) => lock.roomId === room.id)
    if (locked && !this.#wasAdmitted(officeId, room.id, identity.id)) {
      return fail(Refusal.ROOM_LOCKED, `${room.name} is locked. Knock to ask to come in.`)
    }

    // Capacity last, and deliberately after the admission is spent: an
    // invitation is not a reservation, so somebody let into a room that filled
    // while they were reaching for the door is refused and stays where they are.
    const capacity = this.#options.roomCapacity?.(room) ?? null
    if (capacity !== null) {
      const inside = await this.#store.listRoom(officeId, room.id)
      if (inside.length >= capacity) return fail(Refusal.ROOM_FULL, `${room.name} is full.`)
    }
    return null
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
    this.#endFollowing(presence.userId, 'moved_away')
    return done()
  }

  /** The move itself, once every rule has said yes. */
  async #move(officeId: string, presence: Presence, roomId: string): Promise<void> {
    const arrivedAt = new Date(this.#now()).toISOString()
    // Read before the move, because afterwards the lock may already be gone.
    const leftLocked = await this.#isLocked(officeId, presence.roomId)

    /*
     * Leaving a room leaves its call, on every device.
     *
     * The conversation belongs to the room, so walking out of the room is walking
     * out of the conversation — and any screen share goes with it, because a share
     * belongs to the conversation rather than to the person.
     */
    await this.#leaveCallEverywhere(officeId, presence.roomId, presence.userId)

    // Entering the break room is do not disturb, and leaving it clears that
    // again — unless the person chose a status for themselves, which survives.
    const moved = await this.#withBreakRoomStatus(
      officeId,
      // Out of the call as well as out of the room, which is what makes the
      // status stop saying "in a call" on the way out.
      { ...presence, roomId, arrivedAt, inCall: false },
      roomId,
      presence.roomId,
    )

    await this.#store.put(moved)

    // Almost always the small event. The exceptions are the break room, which
    // changes the status on the way in and back on the way out, and leaving a
    // call behind — a bare `person.moved` carries neither, so those moves have to
    // send the person.
    const at = this.#now()
    const statusChanged =
      resolveStatus(moved, at) !== resolveStatus(presence, at) || presence.inCall !== moved.inCall
    this.#broadcaster.queue(
      officeId,
      statusChanged
        ? { kind: 'person.updated', presence: this.#public(moved, at) }
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

    // Whoever follows this person comes along, each by the same rules as walking
    // in themselves. Nobody who follows can be followed, so this never recurses.
    await this.#carryFollowers(officeId, presence.userId, roomId)
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
    // would be a way to lock everybody out of the office. A conference room is for
    // the whole office, so nobody inside gets to shut it; a host that limits who
    // comes in does so through its adapter, at the moment somebody walks in. With
    // no lock there is nothing to knock on, so knocking needs no rule of its own.
    if (!isLockable(room.type)) {
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
    await this.#endKnocks(officeId, roomId)
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
      return fail(
        Refusal.KNOCK_RATE_LIMITED,
        `You have knocked a few times already. Try again in ${seconds(verdict.retryAfterMs)} seconds.`,
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
    this.#grantAdmission(officeId, knock.roomId, knock.userId)

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
   * Let one person into one locked room, once, because the host says so.
   *
   * The hook for a host-side admission: an occupant invited them through
   * something the engine has never heard of, a booking names them, whatever the
   * host's reason is. The engine is not told the reason and does not need one.
   * The next `joinRoom` by that person into that room is honoured exactly as a
   * knock admission is — spent by the move it authorises, standing for nobody
   * else and no other room, and gone when the node restarts, when a minute passes
   * unused or when the person leaves the office — and nothing is unlocked for
   * anybody else.
   *
   * Recorded here and published on the host event bus, so a node holding this
   * person's socket honours it too: the host calls this wherever it is
   * convenient, and the bus carries the fact to wherever the person is. Without
   * a bus, the admission stands on this node alone. Nothing is sent to the
   * person: what to tell them is the host's, since the reason was.
   */
  admitUser(officeId: string, roomId: string, userId: string): void {
    this.#grantAdmission(officeId, roomId, userId)
    this.#options.events?.publish({ type: 'admission.granted', officeId, roomId, userId })
  }

  /** The one place an admission is recorded, for this node's own office only. */
  #grantAdmission(officeId: string, roomId: string, userId: string): void {
    if (officeId !== this.#options.officeId) return
    const at = this.#now()
    // Swept here, as the only place the set grows, so admissions nobody used do
    // not pile up for the life of the process. There is still no scheduler.
    for (const [key, admission] of this.#admissions) {
      if (admission.expiresAt <= at) this.#admissions.delete(key)
    }
    this.#admissions.set(admissionKey(officeId, roomId, userId), {
      userId,
      expiresAt: at + ADMISSION_TTL_MS,
    })
  }

  /** Every admission this person holds here, gone: they left, so they were not coming in. */
  #dropAdmissions(userId: string): void {
    for (const [key, admission] of this.#admissions) {
      if (admission.userId === userId) this.#admissions.delete(key)
    }
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

  // -------------------------------------------------------------------- calls

  /** What this provider can do, so a host can build a policy around it. */
  get provider(): RtcServerPlugin {
    return this.#calls.provider
  }

  /**
   * Join the call in the room you are standing in, starting it if nobody has.
   *
   * Presence and the call are separate: entering a room does not join its call,
   * and this is the explicit act that does. Pressing the microphone joins with
   * audio; pressing the camera joins with video.
   */
  async joinCall(
    connectionId: string,
    request: CallJoinRequest,
  ): Promise<Ack<{ call: CallJoinResponse }>> {
    const resolved = await this.#resolve(connectionId)
    if ('ok' in resolved) return resolved
    const { identity, officeId, presence } = resolved

    const connection = this.#connections.get(connectionId)
    if (!connection) return fail(Refusal.NOT_AUTHENTICATED, 'This connection is not open.')

    const template = await this.#options.templates.get(officeId)
    const room = template?.rooms.find((candidate) => candidate.id === presence.roomId)
    if (!room) return fail(Refusal.ROOM_UNKNOWN, 'There is no such room.')

    // Reception and the break room never have calls. One is a thoroughfare and
    // the other is where people go to not be in a conversation.
    if (!hostsCalls(room.type)) {
      return fail(Refusal.ROOM_NO_CALLS, `There are no calls in ${room.name}.`)
    }

    if (request?.video && !this.#calls.provider.limits.video) {
      return fail(Refusal.CALL_UNSUPPORTED, 'This office does not do video.')
    }

    const permitted = await this.#options.identity.may({
      permission: 'join_call',
      identity,
      officeId,
      roomId: room.id,
    })
    if (!permitted.allowed) return fail(permitted.code, permitted.message)

    /*
     * Already in this call from another device.
     *
     * `move` is the common case and the default: the other device drops its media
     * and stays in the room as presence only, because two live microphones in one
     * place feed back into each other. `add` keeps both, counted separately
     * because each is a real leg in the mesh.
     */
    // Checked at the door already; checked again here because joining is what
    // would overwrite the leg, and a seat held for somebody else on their way back
    // is not this device's to take.
    const occupant = this.#calls.get(officeId, room.id)?.legs.get(connection.deviceId)
    if (occupant && occupant.userId !== identity.id) {
      return fail(Refusal.DEVICE_IN_USE, 'This device is already in the call as somebody else.')
    }

    const mine = this.#calls.legsOf(officeId, room.id, identity.id)
    const elsewhere = mine.filter((leg) => leg.deviceId !== connection.deviceId)
    const rejoining = mine.find((leg) => leg.deviceId === connection.deviceId)
    const second = request?.secondDevice ?? 'move'

    if (elsewhere.length > 0 && second === 'move') {
      for (const leg of elsewhere) await this.#calls.leave(officeId, room.id, leg.deviceId)
    }

    // The cap is the provider's, and counts legs rather than people. A leg being
    // held through a reconnect still counts, so a room cannot fill past somebody
    // on their way back.
    if (!rejoining && this.#calls.isFull(officeId, room.id)) {
      return fail(
        Refusal.CALL_FULL,
        `The call in ${room.name} is full (${this.#calls.provider.limits.maxParticipants} people).`,
      )
    }

    /*
     * An added device joins with its microphone off.
     *
     * Two live audio paths in the same physical room feed back into each other,
     * and the second device is almost always there for its camera or a screen
     * share. Unmuting it is allowed — the person may have moved rooms — and the
     * warning belongs to the control, not to a refusal here.
     *
     * A device coming back from a dropped connection rejoins in the state it
     * left, which is the whole point of having held its seat.
     */
    const audio = rejoining
      ? !rejoining.muted
      : elsewhere.length > 0 && second === 'add'
        ? false
        : Boolean(request?.audio)
    const video = rejoining ? rejoining.cameraOn : Boolean(request?.video)

    const { call, credentials } = await this.#calls.join(
      officeId,
      room.id,
      {
        userId: identity.id,
        deviceId: connection.deviceId,
        displayName: identity.displayName,
      },
      { audio, video },
    )

    // In a call is presence, so it goes on the record the office reads. It
    // outranks automatic away: somebody listening is not idle, whatever their
    // keyboard has been doing.
    await this.#setInCall(officeId, identity.id, true)
    this.#announceCall(officeId, call.roomId)

    return {
      ok: true,
      call: {
        call: this.#calls.toPublic(call),
        credentials: credentials.credentials,
        iceServers: credentials.iceServers,
        // Everyone else, so a new peer knows who to connect to. Itself excluded:
        // a peer connecting to itself is the first bug a mesh ever has.
        participants: [...call.legs.values()]
          .filter((leg) => leg.deviceId !== connection.deviceId)
          .map((leg) => ({
            userId: leg.userId,
            deviceId: leg.deviceId,
            displayName: leg.displayName,
          })),
        ...(elsewhere.length > 0 ? { note: second === 'add' ? 'added' : 'moved' } : {}),
      },
    }
  }

  /** Leave the call, and stay in the room. They are different things. */
  async leaveCall(connectionId: string): Promise<Ack> {
    const resolved = await this.#resolve(connectionId)
    if ('ok' in resolved) return resolved
    const { identity, officeId, presence } = resolved

    const connection = this.#connections.get(connectionId)
    if (!connection) return fail(Refusal.NOT_AUTHENTICATED, 'This connection is not open.')

    const left = await this.#leaveCallLeg(officeId, presence.roomId, connection.deviceId)
    if (!left) return fail(Refusal.NOT_IN_CALL, 'You are not in a call.')

    await this.#refreshInCall(officeId, identity.id, presence.roomId)
    return done()
  }

  /**
   * What this device is publishing, as reported by the adapter.
   *
   * After the fact, deliberately: the adapter says what it actually managed to
   * do, not what it was asked to do, so a camera that failed to start does not
   * show as on to the whole office.
   */
  async setMediaState(connectionId: string, state: MediaStateRequest): Promise<void> {
    const connection = this.#connections.get(connectionId)
    if (!connection?.identity || !connection.officeId) return
    const presence = await this.#store.get(connection.officeId, connection.identity.id)
    if (!presence) return

    const officeId = connection.officeId
    const call = this.#calls.setMedia(officeId, presence.roomId, connection.deviceId, {
      muted: Boolean(state?.muted),
      cameraOn: Boolean(state?.cameraOn),
    })
    if (!call) return

    /*
     * A share goes through the call's one slot, not through this leg.
     *
     * Which is what makes "one share at a time" true rather than intended: the
     * slot belongs to the call, so a second client starting a share takes it, and
     * there is no arrangement of racing clients that ends with two.
     *
     * The displaced sharer is told on its own socket, because it is the only one
     * with a capture still running. A share the server has forgotten about while
     * the operating system is still recording the screen is the worst outcome
     * available here, so it is never left to be noticed.
     */
    if (state?.sharing) {
      const claim = this.#calls.claimShare(officeId, presence.roomId, connection.deviceId)
      for (const displaced of claim?.displaced ?? []) {
        const target = this.#connectionFor(officeId, displaced)
        if (target) {
          this.#transport.toConnection(target, 'call:share_ended', {
            roomId: presence.roomId,
            reason: 'taken_over',
            byUserId: connection.identity.id,
          })
        }
      }
    } else {
      this.#calls.releaseShare(officeId, presence.roomId, connection.deviceId)
    }

    this.#announceCall(officeId, presence.roomId)
    await this.#announcePerson(officeId, presence)
  }

  /**
   * Speaking, from the adapter's own audio level.
   *
   * Sent by the provider's client half so that ordering and indicators are the
   * same whichever provider is behind them — the tiles never measure audio
   * themselves.
   */
  async setSpeaking(connectionId: string, speaking: boolean): Promise<void> {
    const connection = this.#connections.get(connectionId)
    if (!connection?.identity || !connection.officeId) return
    const presence = await this.#store.get(connection.officeId, connection.identity.id)
    if (!presence) return

    const call = this.#calls.setMedia(connection.officeId, presence.roomId, connection.deviceId, {
      speaking: Boolean(speaking),
    })
    if (!call) return

    /*
     * Speaking for more than a moment takes your own hand down.
     *
     * Started here rather than checked later, because a client reports speaking
     * only when it changes: somebody talking steadily sends one event and then
     * nothing, so there is no later moment to check at. The timer is cancelled
     * the moment they stop, which is what makes a short interjection while
     * somebody else finishes not count as your turn.
     */
    if (speaking)
      this.#lowerHandAfterSpeaking(connection.officeId, presence.roomId, connection.deviceId)
    else this.#clearHandTimer(connection.deviceId)

    this.#announceCall(connection.officeId, presence.roomId)
    await this.#announcePerson(connection.officeId, presence)
  }

  /**
   * Put a hand up, or take it down.
   *
   * Per device, like everything else about a call: a leg is a screen, and somebody
   * in the call from a laptop and a phone raised a hand on one of them.
   */
  async raiseHand(connectionId: string, raised: boolean): Promise<Ack> {
    const resolved = await this.#resolve(connectionId)
    if ('ok' in resolved) return resolved
    const { officeId, presence } = resolved

    const connection = this.#connections.get(connectionId)
    if (!connection) return fail(Refusal.NOT_AUTHENTICATED, 'This connection is not open.')

    const call = this.#calls.setHand(officeId, presence.roomId, connection.deviceId, raised)
    if (!call) return fail(Refusal.NOT_IN_CALL, 'You are not in a call.')

    // A hand that is coming down has no reason to be watched any more, and one
    // going up should not inherit a timer from the last time it was up.
    this.#clearHandTimer(connection.deviceId)

    this.#announceCall(officeId, presence.roomId)
    await this.#announcePerson(officeId, presence)
    return done()
  }

  /**
   * React, without interrupting.
   *
   * **Nothing is stored.** This is the one thing in the engine that is sent and
   * forgotten: it is not presence, it is not a diff, and it is not in the
   * snapshot. Somebody who was not looking missed it, which is exactly what
   * happens with a nod in a room.
   *
   * To the room rather than the office, because a reaction is part of a
   * conversation and means nothing three rooms away.
   */
  async react(connectionId: string, reaction: string): Promise<Ack> {
    const resolved = await this.#resolve(connectionId)
    if ('ok' in resolved) return resolved
    const { identity, officeId, presence } = resolved

    const connection = this.#connections.get(connectionId)
    if (!connection) return fail(Refusal.NOT_AUTHENTICATED, 'This connection is not open.')

    // The set is closed so that every client draws the same thing. Anything else
    // is refused rather than passed through, because a client that sent it would
    // be showing something nobody else can.
    if (!(REACTIONS as readonly string[]).includes(reaction)) {
      return fail(Refusal.REACTION_UNKNOWN, 'That is not one of the reactions.')
    }

    const call = this.#calls.get(officeId, presence.roomId)
    if (!call?.legs.has(connection.deviceId)) {
      return fail(Refusal.NOT_IN_CALL, 'You are not in a call.')
    }

    const verdict = await this.#options.limiter.take(
      `react:${identity.id}`,
      REACTION_LIMIT,
      REACTION_WINDOW_MS,
    )
    if (!verdict.allowed) {
      return fail(Refusal.REACTION_RATE_LIMITED, 'That is plenty of reactions for one moment.')
    }

    this.#transport.toRoom(officeId, presence.roomId, 'call:reaction', {
      roomId: presence.roomId,
      userId: identity.id,
      deviceId: connection.deviceId,
      reaction,
      at: new Date(this.#now()).toISOString(),
    })
    return done()
  }

  /** Watch one leg, and lower its hand if it is still talking in a moment. */
  #lowerHandAfterSpeaking(officeId: string, roomId: string, deviceId: string): void {
    if (this.#handTimers.has(deviceId)) return
    const leg = this.#calls.get(officeId, roomId)?.legs.get(deviceId)
    if (!leg || leg.handRaisedAt === null) return

    const timer = setTimeout(() => {
      this.#handTimers.delete(deviceId)
      void this.#lowerHand(officeId, roomId, deviceId)
    }, this.#options.handLowerAfterMs ?? HAND_LOWER_AFTER_MS)
    // Never holds the process open: a hand coming down is not worth staying alive
    // for, which is the same reason the knock timers are unreferenced.
    timer.unref?.()
    this.#handTimers.set(deviceId, timer)
  }

  async #lowerHand(officeId: string, roomId: string, deviceId: string): Promise<void> {
    const call = this.#calls.setHand(officeId, roomId, deviceId, false)
    if (!call) return

    const leg = [...call.legs.values()].find((candidate) => candidate.deviceId === deviceId)
    const presence = leg ? await this.#store.get(officeId, leg.userId) : null

    this.#announceCall(officeId, roomId)
    if (presence) await this.#announcePerson(officeId, presence)
  }

  #clearHandTimer(deviceId: string): void {
    const timer = this.#handTimers.get(deviceId)
    if (!timer) return
    clearTimeout(timer)
    this.#handTimers.delete(deviceId)
  }

  /**
   * Connection quality, straight through to the host's hook.
   *
   * Nothing here reads it. Relayed legs are the ones that cost money, and this is
   * how unityofis finds out about them without the engine knowing what money is.
   */
  async reportQuality(
    connectionId: string,
    sample: { peerDeviceId: string; relayed: boolean; packetLoss: number; roundTripMs: number },
  ): Promise<void> {
    const connection = this.#connections.get(connectionId)
    if (!connection?.identity || !connection.officeId) return

    const call = this.#calls.findByDevice(connection.deviceId)
    if (!call) return

    this.#calls.sample({
      callId: call.callId,
      officeId: call.officeId,
      userId: connection.identity.id,
      deviceId: connection.deviceId,
      peerDeviceId: String(sample?.peerDeviceId ?? ''),
      relayed: Boolean(sample?.relayed),
      packetLoss: Number(sample?.packetLoss) || 0,
      roundTripMs: Number(sample?.roundTripMs) || 0,
    })
  }

  /**
   * Relay one signalling message between two legs of a call.
   *
   * The core reads the address and nothing else. It never sees a byte of media,
   * and it does not look inside the payload — which is what keeps the built-in
   * provider cheap enough to be the free tier.
   *
   * **Scoped to the call**, which is the security of the whole arrangement: a
   * message addressed to a device that is not in the sender's own call goes
   * nowhere, so nothing crosses between rooms and an offer cannot be sent to
   * somebody who is not in a conversation with you.
   */
  /**
   * The open connection a device is on, in this office.
   *
   * The two things that are per-screen rather than per-person — relaying a
   * signalling message and telling a client to stop capturing its screen — both
   * need exactly one socket, and reaching the room or the person instead would be
   * sending private plumbing to people it means nothing to.
   */
  #connectionFor(officeId: string, leg: Pick<CallLeg, 'userId' | 'deviceId'>): string | null {
    // The leg's owner as well as its device, so a socket that is somebody else
    // can never be the one a leg's plumbing is sent to. And the newest match
    // rather than the first: a device that reconnected has its old socket still
    // dying beside the new one for a moment, and only the new one is listening.
    let found: string | null = null
    for (const candidate of this.#connections.values()) {
      if (
        candidate.deviceId === leg.deviceId &&
        candidate.officeId === officeId &&
        candidate.identity?.id === leg.userId
      ) {
        found = candidate.connectionId
      }
    }
    return found
  }

  /**
   * Is this device id somebody else's in this office right now?
   *
   * Three places it could be: an open socket on this node, a call leg — which
   * may be a seat held for somebody on their way back — and a presence record,
   * which is the one that sees devices on other nodes.
   */
  async #deviceHeldByAnother(officeId: string, deviceId: string, userId: string): Promise<boolean> {
    for (const candidate of this.#connections.values()) {
      if (
        candidate.deviceId === deviceId &&
        candidate.officeId === officeId &&
        candidate.identity !== null &&
        candidate.identity.id !== userId
      ) {
        return true
      }
    }
    for (const call of this.#calls.all(officeId)) {
      const leg = call.legs.get(deviceId)
      if (leg && leg.userId !== userId) return true
    }
    const people = await this.#store.list(officeId)
    return people.some(
      (person) =>
        person.userId !== userId && person.devices.some((device) => device.deviceId === deviceId),
    )
  }

  async signal(connectionId: string, message: SignalMessage): Promise<void> {
    const connection = this.#connections.get(connectionId)
    if (!connection?.identity || !connection.officeId) return

    const presence = await this.#store.get(connection.officeId, connection.identity.id)
    if (!presence) return

    const call = this.#calls.get(connection.officeId, presence.roomId)
    const to = String(message?.to ?? '')
    // Both ends have to be in this call: the sender, because otherwise anybody in
    // the office could signal into a conversation, and the recipient, because
    // otherwise the address is a way to reach an arbitrary socket.
    //
    // The sender's leg has to be the sender's own, not merely on the same device
    // id, for the same reason: an id is chosen by the client and proves nothing.
    const sender = call?.legs.get(connection.deviceId)
    const recipient = call?.legs.get(to)
    if (!sender || sender.userId !== connection.identity.id || !recipient) return

    const target = this.#connectionFor(connection.officeId, recipient)
    if (!target) return

    this.#transport.toConnection(target, 'signal', {
      // Filled in here rather than trusted from the sender, so nobody can claim
      // to be somebody else's camera.
      from: connection.deviceId,
      to,
      type: message.type,
      payload: message.payload,
    })
  }

  /** A call that could not connect at all. Reported, never retried forever. */
  async reportCallFailure(connectionId: string, reason: string): Promise<void> {
    const connection = this.#connections.get(connectionId)
    if (!connection?.identity) return
    const call = this.#calls.findByDevice(connection.deviceId)
    if (!call) return

    this.#calls.failed({
      callId: call.callId,
      officeId: call.officeId,
      userId: connection.identity.id,
      deviceId: connection.deviceId,
      reason,
    })
    this.#logger.warn('call connection failed', {
      officeId: call.officeId,
      roomId: call.roomId,
      userId: connection.identity.id,
      code: reason,
    })
  }

  /**
   * Take one device out of a call and tell the office.
   *
   * The single path out, used by leaving a call, leaving a room, a dropped
   * connection whose grace expired, and access being revoked. One path means one
   * place for it to be wrong.
   */
  async #leaveCallLeg(officeId: string, roomId: string, deviceId: string): Promise<boolean> {
    const before = this.#calls.get(officeId, roomId)
    if (!before?.legs.has(deviceId)) return false

    // The hand goes with the leg. It is on the leg rather than on the person, so
    // leaving takes it down by removing the thing it was on — and this only has to
    // stop the timer that was watching it.
    this.#clearHandTimer(deviceId)

    const after = await this.#calls.leave(officeId, roomId, deviceId)

    if (after) this.#announceCall(officeId, roomId)
    else this.#broadcaster.queue(officeId, { kind: 'call.ended', roomId })

    return true
  }

  /** Every leg of this person's, wherever they were, gone. */
  async #leaveCallEverywhere(officeId: string, roomId: string, userId: string): Promise<void> {
    for (const leg of this.#calls.legsOf(officeId, roomId, userId)) {
      await this.#leaveCallLeg(officeId, roomId, leg.deviceId)
    }
  }

  /** In a call, on the presence record, so `resolveStatus` can see it. */
  async #setInCall(officeId: string, userId: string, inCall: boolean): Promise<void> {
    const presence = await this.#store.get(officeId, userId)
    if (!presence || presence.inCall === inCall) return
    const next = { ...presence, inCall }
    await this.#store.put(next)
    await this.#announcePerson(officeId, next)
    // A follower whose move was waiting for this call to end goes now.
    if (!inCall) await this.#catchUp(officeId, userId)
  }

  /** Still in a call? Only if some device of theirs still has a leg. */
  async #refreshInCall(officeId: string, userId: string, roomId: string): Promise<void> {
    const remaining = this.#calls.legsOf(officeId, roomId, userId)
    await this.#setInCall(officeId, userId, remaining.length > 0)
  }

  #announceCall(officeId: string, roomId: string): void {
    const call = this.#calls.get(officeId, roomId)
    if (call)
      this.#broadcaster.queue(officeId, { kind: 'call.updated', call: this.#calls.toPublic(call) })
  }

  /** Re-send one person, because their device state is part of how they are drawn. */
  async #announcePerson(officeId: string, presence: Presence): Promise<void> {
    this.#broadcaster.queue(officeId, {
      kind: 'person.updated',
      presence: this.#public(presence, this.#now()),
    })
  }

  /** A presence record as everyone sees it, with this person's call legs folded in. */
  #public(presence: Presence, at: number = this.#now()): PublicPresence {
    const call = this.#calls.get(presence.officeId, presence.roomId)
    const legs = new Map(
      [...(call?.legs.values() ?? [])]
        .filter((leg) => leg.userId === presence.userId)
        .map((leg) => [leg.deviceId, leg] as const),
    )
    return toPublic(presence, at, legs)
  }

  // ------------------------------------------------------------------- nudges

  /**
   * Tap somebody on the shoulder.
   *
   * One signal to one person, carrying who and at most one line. **Nothing is
   * stored**: not here, not in the presence store, not anywhere. It goes to the
   * recipient's sockets and is forgotten, so a screen that was not connected
   * missed it — which is right, because it is a tap on the shoulder and not a
   * letter.
   *
   * The questions in order: is the request well formed, is the person here, may
   * the sender (the host's adapter, which knows about guests and out of office),
   * what does their status allow, and has the sender done this too often. The
   * status comes before the limits so that being told somebody is on do not
   * disturb does not spend the sender's budget.
   */
  async nudge(
    connectionId: string,
    request: NudgeRequest,
  ): Promise<Ack<{ nudgeId: string; delivery: NudgeDelivery }>> {
    const resolved = await this.#resolve(connectionId)
    if ('ok' in resolved) return resolved
    const { identity, officeId, presence } = resolved

    const targetId = typeof request?.userId === 'string' ? request.userId : ''
    if (targetId.length === 0) return fail(Refusal.MALFORMED, 'Say who to nudge.')
    if (targetId === identity.id) return fail(Refusal.NUDGE_SELF, 'You cannot nudge yourself.')

    const line = cleanNudgeLine(request?.line)
    if (line === null) {
      return fail(Refusal.NUDGE_LINE_INVALID, 'A nudge carries one short line of plain text.')
    }

    // Only somebody in this office: a nudge is about now, and somebody who is not
    // here has nothing to look up from.
    const target = await this.#store.get(officeId, targetId)
    if (!target) {
      return fail(
        Refusal.NUDGE_OFFLINE,
        'They are not in the office right now, so the nudge was not sent.',
      )
    }

    const permitted = await this.#options.identity.may({
      permission: 'nudge',
      identity,
      officeId,
      targetUserId: targetId,
    })
    if (!permitted.allowed) return refusedBy(permitted)

    const at = this.#now()
    const delivery = nudgeDelivery(resolveStatus(target, at), target.displayName)
    if (typeof delivery !== 'string') return fail(delivery.code, delivery.message)

    // The person first: tapping one colleague again and again is the commoner
    // nuisance, and the refusal can name them.
    const limits = this.#nudgeLimits
    const toThem = await this.#options.limiter.take(
      `nudge:${identity.id}:${targetId}`,
      limits.perPersonLimit,
      limits.perPersonWindowMs,
    )
    if (!toThem.allowed) {
      return fail(
        Refusal.NUDGE_RATE_LIMITED_PERSON,
        `You nudged ${target.displayName} a moment ago. Try again in ${seconds(toThem.retryAfterMs)} seconds.`,
        { retry_after_ms: String(toThem.retryAfterMs) },
      )
    }
    const overall = await this.#options.limiter.take(
      `nudge:${identity.id}`,
      limits.perSenderLimit,
      limits.perSenderWindowMs,
    )
    if (!overall.allowed) {
      return fail(
        Refusal.NUDGE_RATE_LIMITED,
        `That is a lot of nudges at once. Try again in ${seconds(overall.retryAfterMs)} seconds.`,
        { retry_after_ms: String(overall.retryAfterMs) },
      )
    }

    const nudgeId = newId()
    this.#transport.toUser(targetId, 'nudge:received', {
      nudgeId,
      userId: identity.id,
      displayName: identity.displayName,
      ...(identity.photoUrl ? { photoUrl: identity.photoUrl } : {}),
      // Where they were when they nudged, so "join them" needs nothing else.
      roomId: presence.roomId,
      ...(line ? { line } : {}),
      delivery,
      at: new Date(at).toISOString(),
    })
    // No line in the log: it is something a person wrote to another person.
    this.#logger.debug('nudged', { officeId, userId: identity.id, targetUserId: targetId })
    return { ok: true, nudgeId, delivery }
  }

  // ----------------------------------------------------------------- following

  /**
   * Ask to follow somebody.
   *
   * Asked for, never taken: a person's movements around the office are not
   * public choreography for anybody to attach themselves to. The request goes to
   * them and waits, and lapses on its own like a knock. Only when the host says
   * this pair needs no asking — an allowance the person being followed gave
   * earlier, which the engine never remembers itself — does it start at once.
   */
  async requestFollow(
    connectionId: string,
    leaderId: string,
  ): Promise<Ack<{ requestId: string; following: boolean }>> {
    const resolved = await this.#resolve(connectionId)
    if ('ok' in resolved) return resolved
    const { identity, officeId } = resolved
    const at = this.#now()

    if (leaderId.length === 0) return fail(Refusal.MALFORMED, 'Say who to follow.')
    if (leaderId === identity.id) return fail(Refusal.FOLLOW_SELF, 'You cannot follow yourself.')

    const leader = await this.#store.get(officeId, leaderId)
    if (!leader) return fail(Refusal.PERSON_UNKNOWN, 'They are not in the office right now.')
    const name = leader.displayName

    // Asking the same person again while they decide is the same request, not a
    // second card on their screen.
    const pending = this.#follows.requestFrom(identity.id, at)
    if (pending?.leaderId === leaderId) {
      return { ok: true, requestId: pending.requestId, following: false }
    }

    const shape = this.#followShapeRefusal(identity.id, leaderId, name)
    if (shape) return shape

    if (resolveStatus(leader, at) === 'dnd') {
      return fail(Refusal.FOLLOW_DND, `${name} is on do not disturb, so they cannot be asked now.`)
    }

    const wait = this.#follows.cooldownLeft(identity.id, leaderId, at)
    if (wait > 0) {
      return fail(
        Refusal.FOLLOW_COOLDOWN,
        `${name} said not now. You can ask again in ${Math.ceil(wait / 60_000)} minutes.`,
        { retry_after_ms: String(wait) },
      )
    }

    const permitted = await this.#options.identity.may({
      permission: 'follow',
      identity,
      officeId,
      targetUserId: leaderId,
    })
    if (!permitted.allowed) return refusedBy(permitted)

    // One request out at a time: asking somebody else withdraws the last one.
    if (pending) this.#withdrawRequest(pending.requestId, pending.leaderId)

    const requestId = newId()
    const standing =
      (await this.#options.identity.followsWithoutAsking?.({
        officeId,
        follower: identity,
        leaderId,
      })) ?? false

    if (standing) {
      await this.#link(officeId, identity.id, leaderId)
      return { ok: true, requestId, following: true }
    }

    const expiresAt = at + this.#followLimits.requestTtlMs
    this.#changeFollow({
      op: 'asked',
      requestId,
      followerId: identity.id,
      leaderId,
      expiresAt,
    })
    this.#transport.toUser(leaderId, 'follow:requested', {
      requestId,
      userId: identity.id,
      displayName: identity.displayName,
      ...(identity.photoUrl ? { photoUrl: identity.photoUrl } : {}),
      expiresAt: new Date(expiresAt).toISOString(),
    })
    this.#sendFollowState(identity.id)

    this.#startFollowTimer(`request:${requestId}`, this.#followLimits.requestTtlMs, () => {
      if (!this.#follows.request(requestId, Number.NEGATIVE_INFINITY)) return
      this.#changeFollow({ op: 'unasked', requestId })
      this.#transport.toUser(identity.id, 'follow:resolved', { requestId, outcome: 'expired' })
      this.#transport.toUser(leaderId, 'follow:resolved', { requestId, outcome: 'expired' })
      this.#sendFollowState(identity.id)
    })

    this.#logger.debug('follow asked', { officeId, userId: identity.id, targetUserId: leaderId })
    return { ok: true, requestId, following: false }
  }

  /** Say yes to a follower. For this session only: the engine remembers nothing. */
  async acceptFollow(connectionId: string, requestId: string): Promise<Ack> {
    const resolved = await this.#resolve(connectionId)
    if ('ok' in resolved) return resolved
    const { identity, officeId, presence } = resolved

    const request = this.#follows.request(requestId, this.#now())
    if (!request || request.leaderId !== identity.id) {
      return fail(Refusal.FOLLOW_UNKNOWN, 'That request is no longer waiting.')
    }

    const follower = await this.#store.get(officeId, request.followerId)
    // Checked again rather than trusted from when they asked: in the minute it
    // waited, somebody else may have filled the last place or started a chain.
    const refusal = follower
      ? this.#followShapeRefusal(request.followerId, identity.id, presence.displayName, true)
      : fail(Refusal.FOLLOW_UNKNOWN, 'They are not in the office any more.')
    if (refusal) {
      this.#withdrawRequest(requestId, identity.id)
      return refusal
    }

    this.#clearFollowTimer(`request:${requestId}`)
    this.#transport.toUser(request.followerId, 'follow:resolved', {
      requestId,
      outcome: 'accepted',
    })
    this.#transport.toUser(identity.id, 'follow:resolved', { requestId, outcome: 'accepted' })
    await this.#link(officeId, request.followerId, identity.id)
    return done()
  }

  /**
   * Say no. Silent to everybody but the asker, who cannot ask again for a while.
   */
  async declineFollow(connectionId: string, requestId: string): Promise<Ack> {
    const resolved = await this.#resolve(connectionId)
    if ('ok' in resolved) return resolved
    const { identity } = resolved
    const at = this.#now()

    const request = this.#follows.request(requestId, at)
    if (!request || request.leaderId !== identity.id) {
      return fail(Refusal.FOLLOW_UNKNOWN, 'That request is no longer waiting.')
    }

    this.#clearFollowTimer(`request:${requestId}`)
    this.#changeFollow({ op: 'unasked', requestId })
    this.#changeFollow({
      op: 'declined',
      followerId: request.followerId,
      leaderId: identity.id,
      until: at + this.#followLimits.declineCooldownMs,
    })
    this.#transport.toUser(request.followerId, 'follow:resolved', {
      requestId,
      outcome: 'declined',
    })
    // The decliner's own other screens, so the card goes from all of them.
    this.#transport.toUser(identity.id, 'follow:resolved', { requestId, outcome: 'declined' })
    this.#sendFollowState(request.followerId)
    return done()
  }

  /**
   * Stop following, or withdraw a request still waiting.
   *
   * Always there while following, and always works: an exit that can be refused
   * is not an exit.
   */
  async stopFollowing(connectionId: string): Promise<Ack> {
    const resolved = await this.#resolve(connectionId)
    if ('ok' in resolved) return resolved
    const { identity } = resolved

    if (this.#follows.linkOf(identity.id)) {
      this.#endFollowing(identity.id, 'stopped')
      return done()
    }
    const pending = this.#follows.requestFrom(identity.id, this.#now())
    if (pending) {
      this.#withdrawRequest(pending.requestId, pending.leaderId)
      return done()
    }
    return fail(Refusal.FOLLOW_NOT_FOLLOWING, 'You are not following anybody.')
  }

  /** The person being followed cutting one follower loose. */
  async removeFollower(connectionId: string, followerId: string): Promise<Ack> {
    const resolved = await this.#resolve(connectionId)
    if ('ok' in resolved) return resolved
    const { identity } = resolved

    if (this.#follows.linkOf(followerId)?.leaderId !== identity.id) {
      return fail(Refusal.FOLLOW_NOT_FOLLOWING, 'They are not following you.')
    }
    this.#endFollowing(followerId, 'removed')
    return done()
  }

  /**
   * Whether this pair can be a follow at all, regardless of who is asking.
   *
   * Following cannot be chained, in either direction: somebody who follows
   * cannot be followed, and somebody being followed cannot follow. And nobody is
   * followed by more than a handful of people at once.
   */
  #followShapeRefusal(
    followerId: string,
    leaderId: string,
    leaderName: string,
    answering = false,
  ): Refused | null {
    const already = this.#follows.linkOf(followerId)
    if (already) {
      return fail(
        Refusal.FOLLOW_ALREADY,
        answering
          ? 'They are already following somebody else.'
          : 'You are already following somebody. Stop first.',
      )
    }
    if (this.#follows.followersOf(followerId).length > 0) {
      return fail(
        Refusal.FOLLOW_CHAIN,
        answering
          ? 'People are following them, so they cannot follow anybody.'
          : 'People are following you, so you cannot follow anybody yourself.',
      )
    }
    if (this.#follows.linkOf(leaderId)) {
      return fail(
        Refusal.FOLLOW_CHAIN,
        answering
          ? 'You are following somebody, so nobody can follow you.'
          : `${leaderName} is following somebody, so they cannot be followed.`,
      )
    }
    if (this.#follows.followersOf(leaderId).length >= this.#followLimits.maxFollowers) {
      return fail(
        Refusal.FOLLOW_FULL,
        answering
          ? `You already have ${this.#followLimits.maxFollowers} people following you.`
          : `${leaderName} already has as many people following them as anybody can.`,
      )
    }
    return null
  }

  /** Start a follow, tell both, and bring the follower to where they are now. */
  async #link(officeId: string, followerId: string, leaderId: string): Promise<void> {
    this.#changeFollow({ op: 'linked', followerId, leaderId, since: this.#now() })
    this.#sendFollowState(followerId)
    this.#sendFollowState(leaderId)
    this.#logger.debug('following', { officeId, userId: followerId, targetUserId: leaderId })

    // Following starts where they are, by the same rules as every later move.
    const leader = await this.#store.get(officeId, leaderId)
    if (leader) await this.#carryFollower(officeId, followerId, leaderId, leader.roomId)
  }

  /** A request withdrawn by the asker, or overtaken: both sides told it is over. */
  #withdrawRequest(requestId: string, leaderId: string): void {
    const request = this.#follows.request(requestId, Number.NEGATIVE_INFINITY)
    this.#clearFollowTimer(`request:${requestId}`)
    this.#changeFollow({ op: 'unasked', requestId })
    this.#transport.toUser(leaderId, 'follow:resolved', { requestId, outcome: 'cancelled' })
    if (request) {
      this.#transport.toUser(request.followerId, 'follow:resolved', {
        requestId,
        outcome: 'cancelled',
      })
      this.#sendFollowState(request.followerId)
    }
  }

  /** End this person's follow, if they have one, and tell both of them why. */
  #endFollowing(followerId: string, reason: FollowEndReason): void {
    const link = this.#follows.linkOf(followerId)
    if (!link) return
    this.#clearFollowTimer(`wait:${followerId}`)
    this.#changeFollow({ op: 'unlinked', followerId })
    const ended = { leaderId: link.leaderId, followerId, reason }
    this.#transport.toUser(followerId, 'follow:ended', ended)
    this.#transport.toUser(link.leaderId, 'follow:ended', ended)
    this.#sendFollowState(followerId)
    this.#sendFollowState(link.leaderId)
  }

  /** Everything following-related about somebody who has gone. */
  #endFollowsOf(userId: string): void {
    this.#endFollowing(userId, 'left')
    for (const follower of this.#follows.followersOf(userId)) {
      this.#endFollowing(follower.followerId, 'left')
    }
    for (const request of this.#follows.requestsInvolving(userId)) {
      this.#withdrawRequest(request.requestId, request.leaderId)
    }
  }

  /** Everybody following this person, to the room they just walked into. */
  async #carryFollowers(officeId: string, leaderId: string, roomId: string): Promise<void> {
    if (officeId !== this.#options.officeId) return
    for (const link of this.#follows.followersOf(leaderId)) {
      await this.#carryFollower(officeId, link.followerId, leaderId, roomId)
    }
  }

  /**
   * One follower, to one room, if they may.
   *
   * Never through a door they could not open themselves: a locked room, a full
   * one, or one they have no access to leaves them where they are, told why, and
   * still following, so the next move picks them up. Somebody in a call is not
   * moved at all — the move waits for the call to end, and a call that goes on
   * too long ends the follow instead, with a line saying so.
   */
  async #carryFollower(
    officeId: string,
    followerId: string,
    leaderId: string,
    roomId: string,
  ): Promise<void> {
    const follower = await this.#store.get(officeId, followerId)
    if (!follower) return
    const link = this.#follows.linkOf(followerId)
    if (!link || link.leaderId !== leaderId) return

    if (follower.roomId === roomId) {
      if (link.waiting) this.#stopWaiting(followerId)
      return
    }

    if (follower.inCall) {
      const until = link.waiting?.until ?? this.#now() + this.#followLimits.callWaitMs
      this.#changeFollow({ op: 'waiting', followerId, roomId, until })
      if (!link.waiting) {
        this.#startFollowTimer(`wait:${followerId}`, until - this.#now(), () => {
          void this.#giveUpWaiting(officeId, followerId)
        })
      }
      this.#transport.toUser(followerId, 'follow:held', {
        leaderId,
        roomId,
        code: Refusal.FOLLOW_WAITING_FOR_CALL,
        message: 'You are in a call, so you will follow once it ends.',
      })
      this.#sendFollowState(followerId)
      return
    }

    const template = await this.#options.templates.get(officeId)
    const room = template?.rooms.find((candidate) => candidate.id === roomId)
    if (!room) return

    // The follower's own identity where their socket is on this node; otherwise
    // the person as the office knows them, which is all a host needs to answer by id.
    const identity = this.#identityOf(followerId) ?? {
      id: followerId,
      displayName: follower.displayName,
    }
    const refused = await this.#entryRefusal(officeId, identity, room)
    if (link.waiting) this.#stopWaiting(followerId)
    if (refused) {
      this.#transport.toUser(followerId, 'follow:held', {
        leaderId,
        roomId,
        code: refused.code,
        message: refused.message,
      })
      return
    }

    await this.#move(officeId, follower, roomId)
    this.#transport.toUser(followerId, 'follow:moved', { leaderId, roomId })
  }

  /** A follower's call ended: if a move was waiting, it goes now — to wherever the leader is. */
  async #catchUp(officeId: string, followerId: string): Promise<void> {
    const link = this.#follows.linkOf(followerId)
    if (!link?.waiting) return
    if (link.waiting.until <= this.#now()) {
      this.#endFollowing(followerId, 'call')
      return
    }
    const leader = await this.#store.get(officeId, link.leaderId)
    if (!leader) return
    await this.#carryFollower(officeId, followerId, link.leaderId, leader.roomId)
  }

  /** The call went on longer than a move waits. The follow stops, and both are told. */
  async #giveUpWaiting(officeId: string, followerId: string): Promise<void> {
    const link = this.#follows.linkOf(followerId)
    if (!link?.waiting) return
    const follower = await this.#store.get(officeId, followerId)
    if (follower && !follower.inCall) {
      await this.#catchUp(officeId, followerId)
      return
    }
    this.#endFollowing(followerId, 'call')
  }

  #stopWaiting(followerId: string): void {
    this.#clearFollowTimer(`wait:${followerId}`)
    this.#changeFollow({ op: 'unwaiting', followerId })
    this.#sendFollowState(followerId)
  }

  /** One change to the follow table: here, and on every other node. */
  #changeFollow(change: FollowChange): void {
    this.#follows.apply(change)
    this.#options.events?.publish({
      type: 'follow.changed',
      officeId: this.#options.officeId,
      change,
    })
  }

  /** The whole of one person's side, to every device they have open. */
  #sendFollowState(userId: string): void {
    this.#transport.toUser(userId, 'follow:state', this.#follows.stateFor(userId, this.#now()))
  }

  #startFollowTimer(key: string, ms: number, run: () => void): void {
    this.#clearFollowTimer(key)
    const timer = setTimeout(
      () => {
        this.#followTimers.delete(key)
        run()
      },
      Math.max(0, ms),
    )
    // Never holds the process open, like every other timer here.
    timer.unref?.()
    this.#followTimers.set(key, timer)
  }

  #clearFollowTimer(key: string): void {
    const timer = this.#followTimers.get(key)
    if (!timer) return
    clearTimeout(timer)
    this.#followTimers.delete(key)
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
      presence: this.#public(chosen, this.#now()),
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
      presence: this.#public(said, this.#now()),
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
        presence: this.#public(active, at),
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
    const mine = people.find((presence) => presence.userId === connection?.identity?.id)

    return {
      officeId,
      seq,
      people: people.map((presence) => this.#public(presence, at)),
      locks: locks.map((lock) => ({ roomId: lock.roomId, lockedBy: lock.lockedBy })),
      // Every call in progress. Visible from outside the room, so nobody walks in
      // on a conversation they did not know was happening.
      calls: this.#calls.all(officeId).map((call) => this.#calls.toPublic(call)),
      you: {
        userId: connection?.identity?.id ?? '',
        deviceId: connection?.deviceId ?? '',
        // Only what this person chose for themselves. Do not disturb that the
        // break room set is automatic as far as they are concerned, and the
        // control offers no way back from something they did not choose.
        manual: mine?.manualFrom === 'user' ? (mine.manual ?? null) : null,
        // Survives a reload like `manual` does: being followed is shown on your
        // own screen, and a fresh tab must not forget who is behind you.
        ...(connection?.identity
          ? { follow: this.#follows.stateFor(connection.identity.id, at) }
          : {}),
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
    const admission = this.#admissions.get(key)
    if (!admission) return false
    this.#admissions.delete(key)
    // Spent either way; only one still inside its minute lets anybody in.
    return admission.expiresAt > this.#now()
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

    await this.#endKnocks(officeId, roomId)
    this.#broadcaster.queue(officeId, { kind: 'room.unlocked', roomId })
  }

  /**
   * Every knock waiting on a door that has just opened, over.
   *
   * However it opened — somebody inside pressing unlock, or the last person
   * walking out — a knock on an open door is a question nobody needs to answer,
   * and a knocker left watching "waiting" on a room they could walk into is the
   * kind of stale screen nobody reports and everybody notices. The card goes from
   * every screen inside too, for anybody still there to have seen it.
   */
  async #endKnocks(officeId: string, roomId: string): Promise<void> {
    const knocks = await this.#store.knocks(officeId, roomId)
    for (const knock of knocks) {
      await this.#store.clearKnock(officeId, knock.id)
      this.#clearKnockTimer(knock.id)
      // Expired rather than admitted: nobody let them in, the door simply stopped
      // being shut, and they still choose whether to walk through it.
      this.#transport.toUser(knock.userId, 'knock:resolved', {
        knockId: knock.id,
        outcome: 'expired',
      })
      this.#transport.toRoom(officeId, roomId, 'knock:resolved', {
        knockId: knock.id,
        outcome: 'expired',
      })
    }
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

  /** Whether this person still has a socket open here on this device. */
  #hasOpenConnection(userId: string, deviceId: string): boolean {
    for (const connectionId of this.#byUser.get(userId) ?? []) {
      if (this.#connections.get(connectionId)?.deviceId === deviceId) return true
    }
    return false
  }

  #track(userId: string, connectionId: string): void {
    const open = this.#byUser.get(userId) ?? new Set<string>()
    open.add(connectionId)
    this.#byUser.set(userId, open)
  }

  /** End somebody's presence entirely and tell the office. */
  async #endPresence(officeId: string, userId: string): Promise<void> {
    this.#cancelGrace(userId)
    // An admission is permission to walk in now. Somebody who has left the office
    // is not walking in now, and coming back later is a new knock.
    if (officeId === this.#options.officeId) this.#dropAdmissions(userId)
    const presence = await this.#store.get(officeId, userId)
    // Before the removal, because afterwards the store has already dropped the
    // lock and there is no way to tell that this is what did it.
    const leftLocked = presence ? await this.#isLocked(officeId, presence.roomId) : false

    // Anything that removes somebody from a room ends their call leg the same way
    // leaving does, and if that empties the call, the call ends.
    if (presence) await this.#leaveCallEverywhere(officeId, presence.roomId, userId)

    await this.#store.remove(officeId, userId)

    // Following dies with either person: leaving the office, going offline for
    // good or losing access all end every follow and request they were part of.
    if (officeId === this.#options.officeId) this.#endFollowsOf(userId)

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
      if (event.officeId !== this.#options.officeId) return
      this.#transport.toOffice(this.#options.officeId, 'template:changed', {
        officeId: this.#options.officeId,
      })
      await this.#evacuateRemovedRooms()
      return
    }

    if (event.type === 'access.changed') {
      if (event.officeId !== undefined && event.officeId !== this.#options.officeId) return
      await this.#recheckAccess(event.userId, event.reason)
      return
    }

    if (event.type === 'status.external') {
      await this.#setExternalStatus(event.userId, event.status, event.quiet === true)
      return
    }

    if (event.type === 'admission.granted') {
      // The same set `admitUser` fills on the node it was called on, so the
      // person is let in from whichever node their socket is on. Arriving back
      // on the node that published it only adds what is already there.
      this.#grantAdmission(event.officeId, event.roomId, event.userId)
      return
    }

    if (event.type === 'follow.changed') {
      // The table only, never a message: the node that made the change has
      // already told whoever needed telling. Idempotent, so hearing our own
      // change back changes nothing.
      if (event.officeId === this.#options.officeId) this.#follows.apply(event.change)
    }
  }

  /**
   * A status the host worked out, such as a meeting starting on somebody's
   * calendar. Broadcast like any other status change; the person's own choice
   * and being in a call still outrank it, because resolving is the store's rule
   * and not this method's.
   */
  async #setExternalStatus(
    userId: string,
    status: 'in_meeting' | null,
    quiet: boolean,
  ): Promise<void> {
    const officeId = this.#options.officeId
    const presence = await this.#store.get(officeId, userId)
    if (!presence) return
    if ((presence.externalStatus ?? null) === status && (presence.externalQuiet ?? false) === quiet)
      return
    const told: Presence = {
      ...presence,
      externalStatus: status,
      externalQuiet: status === null ? false : quiet,
    }
    await this.#store.put(told)
    this.#broadcaster.queue(officeId, {
      kind: 'person.updated',
      presence: this.#public(told, this.#now()),
    })
  }

  /**
   * Whoever is standing in a room the new layout no longer has goes to the break
   * room, which every office has and nobody needs permission for.
   *
   * Through the ordinary move, so the call in the removed room ends leg by leg
   * and a share in it stops with it. Each person is told, because a map that
   * rearranged itself around them with no word is indistinguishable from a bug.
   */
  async #evacuateRemovedRooms(): Promise<void> {
    const officeId = this.#options.officeId
    const template = await this.#options.templates.get(officeId)
    if (!template) return
    const rooms = new Set(template.rooms.map((room) => room.id))
    const refuge = template.rooms.find((room) => room.type === 'break') ?? receptionOf(template)

    for (const presence of await this.#store.list(officeId)) {
      if (rooms.has(presence.roomId)) continue
      await this.#move(officeId, presence, refuge.id)
      this.#transport.toUser(presence.userId, 'office:notice', {
        code: Refusal.ROOM_REMOVED,
        message: `The room you were in was removed from the office, so you are in ${refuge.name} now.`,
      })
    }
  }

  /**
   * Ask the identity adapter again, as at the door, about one person or all.
   *
   * No longer allowed in the office: disconnected, as revocation does. Still in
   * the office but no longer allowed in their room: moved to reception. The
   * questions are the adapter's own, so a host never states a verdict here that
   * its rules would not give.
   */
  async #recheckAccess(userId: string | undefined, reason: string): Promise<void> {
    const officeId = this.#options.officeId
    const present = userId
      ? [await this.#store.get(officeId, userId)].filter((one): one is Presence => one !== null)
      : await this.#store.list(officeId)
    const template = await this.#options.templates.get(officeId)

    for (const presence of present) {
      const identity = this.#identityOf(presence.userId)
      if (!identity) continue

      const office = template
        ? await this.#options.identity.may({ permission: 'enter_office', identity, officeId })
        : ({ allowed: false, code: Refusal.OFFICE_UNKNOWN, message: reason } as const)
      if (!office.allowed || !template) {
        for (const connectionId of this.#byUser.get(presence.userId) ?? []) {
          this.#transport.close(connectionId, {
            code: office.allowed ? Refusal.OFFICE_UNKNOWN : office.code,
            message: reason,
          })
        }
        await this.#endPresence(officeId, presence.userId)
        continue
      }

      const reception = receptionOf(template)
      if (presence.roomId === reception.id) continue
      const room = await this.#options.identity.may({
        permission: 'join_room',
        identity,
        officeId,
        roomId: presence.roomId,
      })
      if (room.allowed) continue
      await this.#move(officeId, presence, reception.id)
      this.#transport.toUser(presence.userId, 'office:notice', { code: room.code, message: reason })
    }
  }

  /** Who a person is, from any of their open connections here. */
  #identityOf(userId: string): Identity | null {
    for (const connectionId of this.#byUser.get(userId) ?? []) {
      const identity = this.#connections.get(connectionId)?.identity
      if (identity) return identity
    }
    return null
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
    for (const timer of this.#handTimers.values()) clearTimeout(timer)
    this.#handTimers.clear()
    this.#admissions.clear()
    for (const timer of this.#followTimers.values()) clearTimeout(timer)
    this.#followTimers.clear()
    this.#follows.clear()
    this.#unsubscribe?.()
    this.#unsubscribe = null
  }
}

/**
 * A partial options object without its `undefined` entries.
 *
 * So a host passing `{ maxFollowers: config.maxFollowers }` with the setting
 * unset gets the default rather than `undefined` spread over it.
 */
function definedOnly<T extends object>(given: Partial<T> | undefined): Partial<T> {
  return Object.fromEntries(
    Object.entries(given ?? {}).filter(([, value]) => value !== undefined),
  ) as Partial<T>
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
function toPublic(
  presence: Presence,
  at: number = Date.now(),
  /**
   * This person's legs in the call in their room, keyed by device.
   *
   * Passed in rather than looked up, because the call lives in its own registry
   * and this function is about the presence record. A device with no leg is in
   * the room and not in the conversation, which is the ordinary case.
   */
  legs: ReadonlyMap<string, CallLeg> = new Map(),
): PublicPresence {
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
    devices: presence.devices.map((device) => {
      const leg = legs.get(device.deviceId)
      return {
        deviceId: device.deviceId,
        kind: device.kind,
        inCall: leg !== undefined,
        muted: leg?.muted ?? true,
        cameraOn: leg?.cameraOn ?? false,
        sharing: leg?.sharing ?? false,
        speaking: leg?.speaking ?? false,
        lastSpokeAt: leg?.lastSpokeAt ?? null,
        handRaisedAt: leg?.handRaisedAt ?? null,
      }
    }),
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

/** The host-set status an identity arrives with, as presence fields. */
function externalOf(identity: Identity): Pick<Presence, 'externalStatus' | 'externalQuiet'> {
  if (identity.externalStatus === undefined) return {}
  return {
    externalStatus: identity.externalStatus,
    externalQuiet: identity.externalStatus !== null && identity.externalQuiet === true,
  }
}
