import type { CustomStatus, Presence, Status } from './types.js'

/**
 * Turning a presence record into the one status a person shows.
 *
 * A pure function over the record, which is why it lives beside the record
 * rather than in the engine: the server resolves it to broadcast, and the client
 * resolves it to render, and there must not be two answers.
 *
 * The order below is the whole rule, and it is ordered by how much it would
 * annoy someone to get it wrong.
 */

/** How long without input before a device counts as idle. */
export const IDLE_AFTER_MS = 10 * 60 * 1000

/**
 * The status this person shows right now.
 *
 * `now` is a parameter rather than a call to the clock, because a custom status
 * expires by comparison at read time and a caller batching a whole office wants
 * every person judged against the same instant.
 */
export function resolveStatus(presence: Presence, now: number = Date.now()): Status {
  // Nobody connected and the grace period gone: they have left.
  if (presence.devices.length === 0) {
    const until = presence.reconnectingUntil ? Date.parse(presence.reconnectingUntil) : 0
    return until > now ? 'reconnecting' : 'offline'
  }

  // Chosen beats worked out. Someone who set do not disturb means it, whatever
  // their keyboard has been doing.
  if (presence.manual) return presence.manual

  // In a call outranks away deliberately: idle detection is suspended while
  // someone is in a call, because a person listening is not idle even though
  // they have not touched anything for twenty minutes. Every call product
  // accepts that a muted person who walked away still reads as in a call.
  if (presence.inCall) return 'in_call'

  // Set by the host from a calendar, and distinct from in a call because the
  // meeting may be somewhere else entirely.
  if (presence.externalStatus === 'in_meeting') return 'in_meeting'

  // Resolves to the most active device. Idle on the laptop while typing on the
  // phone is available; only when every device is idle or backgrounded is the
  // person away.
  const anyActive = presence.devices.some((device) =>
    device.kind === 'mobile' ? device.foreground && !device.idle : !device.idle,
  )
  return anyActive ? 'available' : 'away'
}

/**
 * Whether a custom status is still true.
 *
 * Read-time expiry, so nothing has to run to clear it. A status set to last an
 * hour disappears after an hour because the next reader does this comparison.
 */
export function isCustomStatusLive(custom: CustomStatus | null | undefined, now = Date.now()): boolean {
  if (!custom) return false
  if (!custom.expiresAt) return true
  return Date.parse(custom.expiresAt) > now
}

/** The custom status to show, or null once it has expired. */
export function liveCustomStatus(presence: Presence, now = Date.now()): CustomStatus | null {
  return isCustomStatusLive(presence.custom, now) ? (presence.custom ?? null) : null
}

/**
 * Whether interruptions should be silent for this person.
 *
 * Do not disturb suppresses interruption, not access: a knock still arrives, it
 * just arrives without a sound or a notification, and the knocker is told why it
 * might not be answered. Nothing is refused.
 */
export function suppressesInterruption(presence: Presence, now = Date.now()): boolean {
  return resolveStatus(presence, now) === 'dnd'
}

/**
 * The fixed-length expiry choices, as milliseconds.
 *
 * "Today", "this week" and a chosen time are deliberately absent: where those
 * land depends on the viewer's time zone and on which day their week starts, so
 * the client works out the instant and sends it. The server never computes a
 * date in anybody's zone, and an expiry that arrives here is already absolute.
 */
export const CUSTOM_STATUS_DURATIONS = {
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
} as const

export type CustomStatusDuration = keyof typeof CUSTOM_STATUS_DURATIONS
