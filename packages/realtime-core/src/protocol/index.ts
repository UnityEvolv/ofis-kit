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
  devices: Array<{ deviceId: string; kind: DeviceKind }>
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
 * The whole office.
 *
 * Sent on entry, and again whenever it changes. Sending the whole thing on
 * every change is the simple version and it is deliberately what lands first:
 * the snapshot-and-diffs story replaces it, and doing that before there is
 * anything to diff would be inventing the problem before having it.
 */
export interface OfficeSnapshot {
  officeId: string
  people: PublicPresence[]
  /** Who this client is, so it can find itself without matching on a name. */
  you: { userId: string; deviceId: string }
}

export interface MoveRequest {
  roomId: string
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
  'room:join': (request: MoveRequest, ack: (result: Ack) => void) => void
  'room:leave': (ack: (result: Ack) => void) => void
  'status:manual': (request: StatusRequest, ack: (result: Ack) => void) => void
  'status:custom': (request: CustomStatusRequest, ack: (result: Ack) => void) => void
  'device:activity': (request: ActivityRequest) => void
  /** A refreshed credential, over the socket that is already open. */
  'auth:refresh': (request: { credentials: unknown }, ack: (result: Ack) => void) => void
  heartbeat: (ack: (result: Ack) => void) => void
}

/** What the server sends. */
export interface ServerEvents {
  'office:state': (snapshot: OfficeSnapshot) => void
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

  /** The request did not match the contract. */
  MALFORMED: 'request.malformed',
} as const

export type RefusalCode = (typeof Refusal)[keyof typeof Refusal]
