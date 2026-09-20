import type {
  CustomStatus,
  DeviceKind,
  ManualStatus,
  Status,
} from '@unityevolv/ofiskit-presence-store'
import type { ErrorEnvelope } from '@unityevolv/ofiskit-template'

/**
 * The wire contract, owned by the core and imported by every client.
 *
 * It lives here rather than in the client package because there has to be one
 * copy: two definitions of the same event drift, and the drift shows up as a
 * room that is locked on one screen and open on another. The client depends on
 * this package for the types and imports nothing from it at runtime.
 *
 * Event names are `noun:verb`, lower case, per the conventions. Everything a
 * client sends is acknowledged, and every acknowledgement is either
 * `{ ok: true, ... }` or an error envelope — so a refusal is never
 * indistinguishable from a message that went missing.
 */

export type { CustomStatus, DeviceKind, ManualStatus, Status }

/**
 * A person as everyone else sees them.
 *
 * Deliberately not the stored `Presence`: that carries the raw device signals
 * (idle flags, last-seen timestamps, connection ids) which are nobody else's
 * business and would be sent to the whole office on every heartbeat.
 */
export interface PublicPresence {
  userId: string
  displayName: string
  photoUrl?: string
  /** Always a room. Reception is where somebody is when they are nowhere else. */
  roomId: string
  /**
   * One entry per connected device.
   *
   * A list rather than a count, because presence is per user and the map has to
   * be able to say what somebody is on. What each device is *doing* — in the
   * call, muted, sharing — arrives with the stories that give it meaning.
   */
  devices: Array<{
    deviceId: string
    kind: DeviceKind
    /**
     * Whether this device is in the room's call.
     *
     * Per device, not per person, because presence and the call are separate
     * things and one person may be in the room from two devices with only one of
     * them in the conversation.
     */
    inCall: boolean
    muted: boolean
    cameraOn: boolean
    sharing: boolean
    speaking: boolean
    /**
     * When this device last started speaking, or null if it never has.
     *
     * Stamped by the server so that everybody in the call sees the same five
     * faces: a client that joined a minute ago has no less idea of who spoke
     * recently than one that has been listening throughout.
     */
    lastSpokeAt: string | null
  }>
  /**
   * Already resolved, so clients render it rather than working it out again.
   *
   * This replaces the `reconnecting` flag the disconnect story added:
   * reconnecting is one of the values a status can have, and two fields that
   * can disagree about the same thing is one field too many.
   */
  status: Status
  /** Absent once it has expired, because expiry is checked as it is read. */
  custom?: CustomStatus
  /** When they arrived in this room. Avatars are ordered by it, so they hold still. */
  arrivedAt: string
}

/**
 * A call happening in a room.
 *
 * Separate from the people in the room on purpose: entering a room does not join
 * its call, and somebody is in the room whether or not they are in the
 * conversation happening in it. Joining is always explicit.
 */
export interface RoomCall {
  roomId: string
  /** Fixed when the call starts. A provider change applies to the next call. */
  provider: string
  startedAt: string
  /** One entry per device leg, because a leg is a device and not a person. */
  participants: Array<{ userId: string; deviceId: string }>
  /** The provider's cap, so the UI can say "full" without knowing the provider. */
  limit: number
}

/** One ICE server, in the shape a browser's RTCPeerConnection takes. */
export interface IceServer {
  urls: string | string[]
  username?: string
  credential?: string
}

/**
 * The whole office.
 *
 * Sent **once**, on entry, so the map can render immediately — and again only
 * when a client asks for it because it noticed a gap. Everything after the first
 * one is a diff.
 */
export interface OfficeSnapshot {
  officeId: string
  /**
   * The last event number this snapshot accounts for.
   *
   * A client keeps it and compares the next diff against it, which is the whole
   * mechanism: a snapshot with no number cannot be told apart from a snapshot
   * that is already stale by three events.
   *
   * Read as a floor rather than an exact instant. The snapshot may already
   * contain changes that are still gathering into the next diff, so the first
   * diff after it can restate what it already had. Every change is idempotent,
   * so that costs nothing.
   */
  seq: number
  people: PublicPresence[]
  /**
   * Every locked room.
   *
   * In the snapshot rather than worked out from the people inside, because a
   * lock is not a property of who is in the room — it is visible from the whole
   * office so that nobody is surprised by a door that will not open.
   */
  locks: Array<{ roomId: string; lockedBy: string }>
  /** Every call in progress. Visible from outside the room, so nobody walks in blind. */
  calls: RoomCall[]
  /**
   * Who this client is, so it can find itself without matching on a name.
   *
   * `manual` is the status this person chose, or null when the office is working
   * it out for them. It is here and not on `PublicPresence` because it is nobody
   * else's business: the office can see that somebody is on do not disturb, and
   * whether they meant it or walked into the break room is between them and
   * their own screen. The control needs it to know whether to offer a way back
   * to automatic, and it has to survive a reload, which is why it travels rather
   * than being remembered on the client.
   */
  you: { userId: string; deviceId: string; manual: ManualStatus | null }
}

/**
 * One thing that changed.
 *
 * Diffs, never the whole office again: a hundred people watching one person walk
 * across the map is a hundred small events, not a hundred copies of the office.
 *
 * `person.moved` is deliberately narrower than `person.updated` — a move is the
 * commonest change by a wide margin, and sending a whole person to say they
 * walked through a door is most of what made the full-state broadcast expensive.
 */
export type OfficeChange =
  | { kind: 'person.entered'; presence: PublicPresence }
  | { kind: 'person.moved'; userId: string; roomId: string; arrivedAt: string }
  | { kind: 'person.updated'; presence: PublicPresence }
  | { kind: 'person.left'; userId: string }
  | { kind: 'room.locked'; roomId: string; lockedBy: string }
  | { kind: 'room.unlocked'; roomId: string }
  | { kind: 'call.updated'; call: RoomCall }
  | { kind: 'call.ended'; roomId: string }

export interface OfficeDiff {
  /**
   * Per office, and strictly increasing.
   *
   * A client that receives seq 12 having last seen 10 knows it missed one and
   * asks for a snapshot, rather than drawing state that is quietly wrong and
   * staying wrong until somebody reloads. It covers more than a dropped packet:
   * there is a sliver between a client being sent its snapshot and being
   * subscribed to the office, and a change landing in it is found this way
   * rather than being prevented by locking something.
   */
  seq: number
  changes: OfficeChange[]
}

export interface MoveRequest {
  roomId: string
}

export interface KnockRequest {
  roomId: string
}

export interface KnockReplyRequest {
  knockId: string
}

export interface CallJoinRequest {
  /** Pressing the microphone joins with audio; pressing the camera joins with video. */
  audio: boolean
  video: boolean
  /**
   * What to do when this person is already in the call from another device.
   *
   * `move` drops the other device's media and leaves it in the room as presence
   * only — the common case, and the default. `add` joins as a second leg, which
   * counts against the room's capacity because it is a real leg in the mesh.
   */
  secondDevice?: 'move' | 'add'
}

export interface CallJoinResponse {
  call: RoomCall
  /** Whatever this provider's client adapter needs. Nothing else reads it. */
  credentials: unknown
  iceServers: IceServer[]
  /** Who is already here, so a new peer knows who to connect to. */
  participants: Array<{ userId: string; deviceId: string; displayName: string }>
  /**
   * Set when this join made an added device the primary, or moved the call here.
   *
   * The person is told, rather than finding out by their microphone having moved.
   */
  note?: 'moved' | 'added'
}

/**
 * One signalling message, relayed between two legs of a call.
 *
 * Addressed by **device**, not by person: a mesh connects screens to each other,
 * and somebody with a laptop and a phone in the same call is two peers.
 *
 * The core reads `to` and nothing else. The payload is an opaque SDP or ICE
 * candidate, and the core never looks inside it — which is what makes it cheap
 * enough to be the free tier, and the reason it can carry a future provider's
 * signalling without knowing what that provider says.
 */
export interface SignalMessage {
  to: string
  /** Filled in by the server on the way out, so nobody can claim to be somebody. */
  from?: string
  type: 'offer' | 'answer' | 'candidate'
  payload: unknown
}

/** What one device is publishing. Reported by the adapter, after it actually did it. */
export interface MediaStateRequest {
  muted: boolean
  cameraOn: boolean
  sharing: boolean
}

export interface SpeakingRequest {
  speaking: boolean
}

export interface StatusRequest {
  /** null puts the person back on automatic. */
  manual: ManualStatus | null
}

export interface CustomStatusRequest {
  /**
   * null clears it.
   *
   * `expiresAt` is an absolute instant worked out by the client, because where
   * "today" and "this week" land depends on the viewer's time zone and the
   * server never computes a date in anybody's zone.
   */
  custom: CustomStatus | null
}

/** One device's own signals. Never a conclusion about the person. */
export interface ActivityRequest {
  idle: boolean
  /** Mobile only; ignored elsewhere. */
  foreground: boolean
}

/** What a client sends to say who it is. */
export interface EnterOfficeRequest {
  /** Whatever the host's identity adapter understands. The core never reads it. */
  credentials: unknown
  /** Stable per installation, so a reconnect is recognised as the same device. */
  deviceId: string
  kind: DeviceKind
}

/**
 * A refusal: the other arm of every acknowledgement.
 *
 * Named, because a handler that only ever refuses wants to say so in its return
 * type, and because `Ack<never>` does not mean what it looks like it means.
 */
export type Refused = { ok: false } & ErrorEnvelope

/**
 * Acknowledgements. Either it worked, or here is exactly why it did not.
 *
 * The default is `unknown` rather than `void`: intersecting the success arm
 * with `void` collapses the whole arm to `never`, which quietly turns a plain
 * `Ack` into "this can only ever fail".
 */
export type Ack<T = unknown> = ({ ok: true } & T) | Refused

/** What a client may send. */
export interface ClientEvents {
  'office:enter': (
    request: EnterOfficeRequest,
    ack: (result: Ack<{ snapshot: OfficeSnapshot }>) => void,
  ) => void
  'office:leave': (ack: (result: Ack) => void) => void
  /**
   * "I have lost track — tell me everything again."
   *
   * Sent when a diff's sequence number skips, and after a reconnect. A client
   * asking for this is the only reason the whole office is ever sent twice.
   */
  'office:resync': (ack: (result: Ack<{ snapshot: OfficeSnapshot }>) => void) => void
  'room:join': (request: MoveRequest, ack: (result: Ack) => void) => void
  'room:leave': (ack: (result: Ack) => void) => void
  'room:lock': (request: MoveRequest, ack: (result: Ack) => void) => void
  'room:unlock': (request: MoveRequest, ack: (result: Ack) => void) => void
  /**
   * Ask to come into a locked room.
   *
   * `silent` in the acknowledgement means everyone inside is on do not disturb,
   * so the knock arrived without a sound. The knocker is told, because otherwise
   * an unanswered knock is indistinguishable from a broken one.
   */
  'room:knock': (
    request: KnockRequest,
    ack: (result: Ack<{ knockId: string; silent: boolean }>) => void,
  ) => void
  'knock:admit': (request: KnockReplyRequest, ack: (result: Ack) => void) => void
  'knock:decline': (request: KnockReplyRequest, ack: (result: Ack) => void) => void

  /** Joining is explicit: pressing the microphone or the camera is what does it. */
  'call:join': (
    request: CallJoinRequest,
    ack: (result: Ack<{ call: CallJoinResponse }>) => void,
  ) => void
  'call:leave': (ack: (result: Ack) => void) => void
  /** No acknowledgement: these arrive constantly and nobody waits on them. */
  'call:media': (request: MediaStateRequest) => void
  'call:speaking': (request: SpeakingRequest) => void
  signal: (message: SignalMessage) => void
  'call:quality': (request: {
    peerDeviceId: string
    relayed: boolean
    packetLoss: number
    roundTripMs: number
  }) => void
  'status:manual': (request: StatusRequest, ack: (result: Ack) => void) => void
  'status:custom': (request: CustomStatusRequest, ack: (result: Ack) => void) => void
  'device:activity': (request: ActivityRequest) => void
  /** A refreshed credential, over the socket that is already open. */
  'auth:refresh': (request: { credentials: unknown }, ack: (result: Ack) => void) => void
  heartbeat: (ack: (result: Ack) => void) => void
}

/** What the server sends. */
export interface ServerEvents {
  /**
   * One small event per thing that changed, and the only thing the office is
   * ever sent.
   *
   * The whole office is not here on purpose: a snapshot only ever arrives as the
   * acknowledgement to `office:enter` or `office:resync`, which is to say
   * because a client asked. Pushing one would mean deciding on the server that
   * somebody has lost track, and the server cannot know that.
   */
  'office:diff': (diff: OfficeDiff) => void
  /** A signalling message from another leg, with `from` filled in by the server. */
  signal: (message: SignalMessage & { from: string }) => void
  /**
   * Somebody is knocking.
   *
   * Per person rather than per room, because `silent` differs between two people
   * standing in the same room: it is true for whoever is on do not disturb and
   * false for the colleague beside them. The knock still arrives either way —
   * do not disturb suppresses interruption, not access.
   */
  'knock:received': (event: {
    knockId: string
    roomId: string
    userId: string
    displayName: string
    photoUrl?: string
    silent: boolean
    expiresAt: string
  }) => void
  /** A knock is over, one way or another. Sent to the room and to the knocker. */
  'knock:resolved': (event: {
    knockId: string
    outcome: 'admitted' | 'declined' | 'expired'
    byUserId?: string
  }) => void
  /**
   * You were let in.
   *
   * An invitation to move, not a reservation: the client still sends
   * `room:join`, and that join can still be refused because the room filled in
   * the meantime. Nothing was held open.
   */
  'knock:admitted': (event: { roomId: string; byUserId: string }) => void
  /** The template on disk changed; re-read it. */
  'template:changed': (event: { officeId: string }) => void
  /** Your credential is about to stop working. Send a fresh one on this socket. */
  'auth:refresh_required': (event: { withinMs: number }) => void
  /** You are being disconnected, and this is why. Never a silent drop. */
  disconnected: (event: ErrorEnvelope) => void
}

/**
 * Every way the core refuses something.
 *
 * Stable and documented: a client branches on these, and they are what the UI
 * turns into the sentence under a disabled control, so each one has to mean a
 * different thing. A refusal a client cannot tell from another refusal is a bug
 * in the contract rather than in the client.
 */
export const Refusal = {
  /** The socket has not said who it is yet. */
  NOT_AUTHENTICATED: 'auth.required',
  /** The identity adapter refused the credentials. */
  AUTH_REFUSED: 'auth.refused',
  /** The credential expired and no refresh arrived. */
  AUTH_EXPIRED: 'auth.expired',
  /** Access ended while the socket was open. */
  ACCESS_REVOKED: 'auth.revoked',

  /** The office has no template, or the id is not this office. */
  OFFICE_UNKNOWN: 'office.unknown',
  /** The identity adapter said no to entering. */
  OFFICE_FORBIDDEN: 'office.forbidden',
  /** Not in an office, so there is nothing to do this in. */
  NOT_PRESENT: 'office.not_present',

  ROOM_UNKNOWN: 'room.unknown',
  /** The identity adapter said no: restricted, not a member, a guest. */
  ROOM_FORBIDDEN: 'room.forbidden',
  /** Full at the moment you tried. Nothing was ever held for you. */
  ROOM_FULL: 'room.full',
  /** Already there. Not an error worth showing, but not a success either. */
  ROOM_ALREADY_THERE: 'room.already_there',
  /** Closed to interruption. Knock to ask. */
  ROOM_LOCKED: 'room.locked',
  /** Reception and the break room never have calls. */
  ROOM_NO_CALLS: 'room.no_calls',
  /** The call is at the provider's cap. Not the same as the room being full. */
  CALL_FULL: 'call.full',
  /** Asked to leave a call, or report media, while not in one. */
  NOT_IN_CALL: 'call.not_in',
  /** The provider cannot do what was asked: video, or a screen share. */
  CALL_UNSUPPORTED: 'call.unsupported',
  /** Locking is for the people in the conversation, so you have to be in it. */
  ROOM_NOT_INSIDE: 'room.not_inside',
  /** Reception and the break room are open to everyone by design. */
  ROOM_NOT_LOCKABLE: 'room.not_lockable',

  /** Knocking on a room you are standing in. */
  KNOCK_INSIDE: 'knock.inside',
  /** The room is open. Walk in; there is nobody to ask. */
  KNOCK_NOT_LOCKED: 'knock.not_locked',
  /** Admitted, declined, expired, or never existed. All the same to the caller. */
  KNOCK_UNKNOWN: 'knock.unknown',
  /** Enough. A knock interrupts everyone in the room. */
  KNOCK_RATE_LIMITED: 'knock.rate_limited',

  /** The request did not match the contract. */
  MALFORMED: 'request.malformed',
} as const

export type RefusalCode = (typeof Refusal)[keyof typeof Refusal]
