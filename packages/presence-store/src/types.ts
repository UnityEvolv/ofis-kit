/**
 * Who is where, and what they are doing.
 *
 * The shapes here are the ones that travel: they go into the store, into the
 * office snapshot, and out to every client. They are deliberately small, because
 * a diff carrying one of these is sent to everyone in the office every time
 * anybody moves.
 */

/** Instants are ISO 8601 in UTC with the zone explicit. Never a formatted date. */
export type Instant = string

/**
 * What the product worked out about someone, from their devices and their room.
 *
 * `reconnecting` is not a state anyone chooses: it is what everyone else sees
 * during the disconnect grace period, so a laptop closing for ten seconds does
 * not look like someone leaving.
 */
export type AutomaticStatus =
  | 'available'
  | 'in_call'
  | 'in_meeting'
  | 'away'
  | 'dnd'
  | 'reconnecting'
  | 'offline'

/**
 * What someone chose for themselves. Always wins over the automatic status.
 *
 * A short list on purpose. Anything more expressive is a custom status, which is
 * text and does not have to be understood by the product.
 */
export type ManualStatus = 'available' | 'away' | 'dnd'

/** The status a person actually shows, which is the manual one when there is one. */
export type Status = AutomaticStatus

/**
 * Slack-style custom status: a few words, maybe an emoji, and when it stops
 * being true.
 *
 * `expiresAt` is checked when the status is read, never swept by a timer. There
 * is no scheduler anywhere in the engine, and a status that disappears because
 * two instants were compared is one less thing that can be left running.
 */
export interface CustomStatus {
  text: string
  emoji?: string
  /** Absent means it stays until cleared. */
  expiresAt?: Instant
}

/** What kind of thing someone is connected from. Decides the device badge. */
export type DeviceKind = 'web' | 'desktop' | 'mobile'

/**
 * One connection belonging to one person.
 *
 * Presence is per user, not per device, so these are the inputs to one person's
 * status rather than separate people. Someone idle on a laptop while typing on a
 * phone is available, and only when every device is idle or backgrounded do they
 * go away.
 */
export interface DevicePresence {
  /** The socket. Unique per connection, and gone when it closes. */
  connectionId: string
  /** Stable per installation, so a reconnect is recognised as the same device. */
  deviceId: string
  kind: DeviceKind
  /** No keyboard or mouse for the idle window, or the screen locked. */
  idle: boolean
  /** Mobile only, and the thing that decides away on a phone. */
  foreground: boolean
  connectedAt: Instant
  /** Refreshed by the heartbeat. The store's TTL is measured from this. */
  lastSeenAt: Instant
}

/**
 * One person in one office.
 *
 * Presence is one office at a time: entering a second office ends presence in
 * the first, so there is never a question of which one a move applies to.
 */
export interface Presence {
  userId: string
  officeId: string
  /** Always a room. Reception is where someone is when they are nowhere else. */
  roomId: string
  displayName: string
  photoUrl?: string
  /** At least one while present. When the last one goes, so does the record. */
  devices: DevicePresence[]
  /** Chosen explicitly, and it beats everything automatic until cleared. */
  manual?: ManualStatus | null
  /**
   * Who set the manual status.
   *
   * `user` means the person chose it, and it survives everything: walking into
   * the break room, going idle, a call ending. `room` means the break room set
   * it, and it is cleared on the way out. Without this distinction, stepping
   * into the break room once would pin somebody to do not disturb for the rest
   * of the day, because there is no way to tell the two apart afterwards.
   */
  manualFrom?: 'user' | 'room' | null
  custom?: CustomStatus | null
  /** Set by the RTC layer when they join a call, cleared when they leave. */
  inCall: boolean
  /**
   * A status the host set from outside, such as in a meeting from a calendar.
   * The engine never works this out for itself; it is told, through the
   * identity adapter, and the free app is never told anything.
   */
  externalStatus?: 'in_meeting' | null
  /**
   * Whether the host's status also silences interruptions, the way do not
   * disturb does. A host rule, such as an organisation deciding that being in a
   * meeting means knocks arrive quietly; without it a meeting is only a status.
   */
  externalQuiet?: boolean
  /**
   * Set when the last device drops. Until this instant the person stays in their
   * room, shown to others as reconnecting; after it they are gone.
   */
  reconnectingUntil?: Instant | null
  enteredAt: Instant
  /** When they last changed room. Used to order avatars by arrival. */
  arrivedAt: Instant
}

/**
 * A room that someone inside has closed to interruption.
 *
 * Held beside presence because it is exactly as ephemeral: it must be visible to
 * every node, and it must not survive the room emptying. A lock in a database
 * would outlive the conversation it was protecting.
 */
export interface RoomLock {
  roomId: string
  /** Who turned it on. Anyone inside can turn it off again. */
  lockedBy: string
  lockedAt: Instant
}

/** Someone outside a locked room asking to come in. */
export interface Knock {
  id: string
  roomId: string
  /** The person asking. */
  userId: string
  displayName: string
  photoUrl?: string
  createdAt: Instant
  /** Knocks expire on their own, so none of them sits there forever. */
  expiresAt: Instant
}
