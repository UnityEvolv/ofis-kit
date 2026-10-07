import type { Status } from '@unityevolv/ofiskit-presence-store'

import { NUDGE_LINE_MAX, Refusal, type NudgeDelivery } from './protocol/index.js'

/**
 * The rules of a nudge that need no office to be true.
 *
 * A nudge is a one-shot signal to one person, carrying who sent it and at most
 * one plain line. **Nothing about it is stored**: it lives in the socket and on
 * the recipient's screen, like a reaction. These are the parts of that rule that
 * are pure — what a status does to a nudge, and what a line may be — kept out of
 * the engine so they can be read, and tested, in one sitting.
 */

/**
 * How often somebody may nudge, and whom.
 *
 * Two limits, because there are two ways to be a nuisance: tapping one person
 * again and again, and tapping everybody. The second is the larger number on
 * purpose — nudging three colleagues to say a meeting is starting is ordinary.
 */
export interface NudgeOptions {
  /** Nudges to one person, per sender, per window. */
  perPersonLimit: number
  perPersonWindowMs: number
  /** Nudges to anybody, per sender, per window. */
  perSenderLimit: number
  perSenderWindowMs: number
}

/**
 * The decided limits: three a minute to one person, ten a minute overall.
 *
 * Defaults rather than constants, so a host changes them in its configuration
 * and not in this file.
 */
export const NUDGE_DEFAULTS: Readonly<NudgeOptions> = Object.freeze({
  perPersonLimit: 3,
  perPersonWindowMs: 60_000,
  perSenderLimit: 10,
  perSenderWindowMs: 60_000,
})

/** Why a nudge cannot be delivered, given the recipient's status. */
export interface NudgeRefusal {
  code: string
  message: string
}

/**
 * What the recipient's status does to a nudge.
 *
 * Available: straight to their screen. Busy or in a call: held quietly until the
 * call ends, because interrupting a call with a tap on the shoulder is exactly
 * what must not happen. Do not disturb, away, offline: refused at the server and
 * the sender told plainly. Never queued and never delivered later — a nudge is
 * about now, and a stale one is noise.
 */
export function nudgeDelivery(status: Status, name: string): NudgeDelivery | NudgeRefusal {
  switch (status) {
    case 'available':
      return 'now'
    case 'in_call':
    case 'in_meeting':
      return 'held'
    case 'dnd':
      return {
        code: Refusal.NUDGE_DND,
        message: `${name} is on do not disturb, so the nudge was not sent.`,
      }
    case 'away':
      return {
        code: Refusal.NUDGE_AWAY,
        message: `${name} is away right now, so the nudge was not sent.`,
      }
    case 'reconnecting':
    case 'offline':
      return {
        code: Refusal.NUDGE_OFFLINE,
        message: `${name} is not connected right now, so the nudge was not sent.`,
      }
  }
}

/**
 * One plain line, or nothing.
 *
 * Whitespace is folded to single spaces, so a pasted paragraph arrives as the one
 * line it is drawn as. Anything still unprintable is refused rather than
 * stripped: a client that sent it was not drawing what it sent. `undefined`
 * means no line at all; `null` means the line is not allowed.
 */
export function cleanNudgeLine(line: unknown): string | undefined | null {
  if (line === undefined || line === null) return undefined
  if (typeof line !== 'string') return null
  const folded = line.replace(/\s+/g, ' ').trim()
  if (folded.length === 0) return undefined
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is being refused
  if (/[\u0000-\u001f\u007f]/.test(folded)) return null
  if ([...folded].length > NUDGE_LINE_MAX) return null
  return folded
}
