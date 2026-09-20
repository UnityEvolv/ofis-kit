import type { PresenceStore } from '@unityevolv/ofiskit-presence-store'

import type { OfficeChange, OfficeDiff } from './protocol/index.js'
import type { Transport } from './transport.js'

/**
 * How the office is told that something changed.
 *
 * Until this story the engine re-sent the whole office on every change, which is
 * the honest simple version and was deliberately left in place while there was
 * nothing to diff. It stops being honest at scale: a hundred people watching one
 * person walk across the map is a hundred copies of the office, every one of
 * them almost entirely the state its reader already had.
 *
 * So changes go out as numbered diffs, and this class does the two jobs that
 * makes possible. It **coalesces**, so a burst from one person is one event; and
 * it **numbers**, so a client that misses an event can tell. Both exist because
 * the alternative is a client that is quietly wrong — either flooded into
 * lagging, or holding stale state with no way to find out.
 */

/**
 * How long changes are gathered before they go out.
 *
 * Short on purpose: long enough to collapse somebody dragging their avatar
 * across three rooms, short enough that nobody perceives it. A person walking
 * into a room should appear immediately, not a beat later.
 */
export const DIFF_WINDOW_MS = 50

/**
 * What key a change collapses on.
 *
 * Changes about the same thing supersede each other, and everything about one
 * person shares a key. That is what turns a drag through three rooms into one
 * event: the office is told where somebody ended up rather than being walked
 * through the journey, which it has no use for and could not render anyway.
 */
function keyOf(change: OfficeChange): string {
  switch (change.kind) {
    case 'person.entered':
    case 'person.updated':
      return `person:${change.presence.userId}`
    case 'person.moved':
    case 'person.left':
      return `person:${change.userId}`
    // A room's own key, so locking and unlocking it twice in a window is one
    // event about the door and does not collapse with the people behind it.
    case 'room.locked':
    case 'room.unlocked':
      return `room:${change.roomId}`
  }
}

export class Broadcaster {
  readonly #store: PresenceStore
  readonly #transport: Transport
  readonly #windowMs: number
  /** officeId → pending changes, keyed so a later one supersedes an earlier one. */
  readonly #pending = new Map<string, Map<string, OfficeChange>>()
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(store: PresenceStore, transport: Transport, windowMs: number = DIFF_WINDOW_MS) {
    this.#store = store
    this.#transport = transport
    this.#windowMs = windowMs
  }

  /**
   * Queue a change for the office.
   *
   * Two collapsing rules are worth knowing about, because both are about a
   * client that has not seen this person yet:
   *
   * - An update following an entry re-sends the **entry**, carrying the new
   *   state. Sending an update about somebody a client has never heard of
   *   leaves it with nothing to apply the update to.
   * - A departure following an entry cancels **both**. Nobody ever saw them
   *   arrive, so telling the office that a stranger has left is pure noise.
   */
  queue(officeId: string, change: OfficeChange): void {
    const pending = this.#pending.get(officeId) ?? new Map<string, OfficeChange>()
    this.#pending.set(officeId, pending)

    const key = keyOf(change)
    const existing = pending.get(key)

    if (existing?.kind === 'person.entered') {
      if (change.kind === 'person.left') {
        pending.delete(key)
        this.#arm(officeId)
        return
      }
      if (change.kind === 'person.updated') {
        pending.set(key, { kind: 'person.entered', presence: change.presence })
        this.#arm(officeId)
        return
      }
      if (change.kind === 'person.moved') {
        pending.set(key, {
          kind: 'person.entered',
          presence: { ...existing.presence, roomId: change.roomId, arrivedAt: change.arrivedAt },
        })
        this.#arm(officeId)
        return
      }
    }

    pending.set(key, change)
    this.#arm(officeId)
  }

  #arm(officeId: string): void {
    if (this.#timers.has(officeId)) return
    const timer = setTimeout(() => {
      this.#timers.delete(officeId)
      void this.flush(officeId)
    }, this.#windowMs)
    // Never hold the process open for a pending diff. An office emptying is a
    // perfectly good reason for a batch never to be sent.
    timer.unref?.()
    this.#timers.set(officeId, timer)
  }

  /**
   * Send whatever is pending, now.
   *
   * Called by the timer, and directly before a snapshot is taken and on
   * shutdown — both of which want everything out before they look.
   */
  async flush(officeId: string): Promise<void> {
    const timer = this.#timers.get(officeId)
    if (timer) {
      clearTimeout(timer)
      this.#timers.delete(officeId)
    }

    const pending = this.#pending.get(officeId)
    if (!pending || pending.size === 0) return

    const changes = [...pending.values()]
    pending.clear()

    // The number is allocated by the store rather than counted here, because in
    // unityofis the clients receiving it are spread across nodes and a counter
    // per process would give two of them the same number for different diffs.
    const diff: OfficeDiff = { seq: await this.#store.nextSequence(officeId), changes }
    this.#transport.toOffice(officeId, 'office:diff', diff)
  }

  /** Stop everything, so no timer outlives the server. */
  dispose(): void {
    for (const timer of this.#timers.values()) clearTimeout(timer)
    this.#timers.clear()
    this.#pending.clear()
  }
}
