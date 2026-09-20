import type { Knock, Presence, RoomLock } from './types.js'

/**
 * Where who-is-where lives.
 *
 * Two implementations exist: the in-memory one in this package, which the free
 * office uses and which is why restarting the server empties the office, and a
 * Redis one in unityofis, which is how the product runs many nodes.
 *
 * Every method is async even though the memory one never waits. The alternative
 * is a synchronous interface that Redis cannot implement, which would mean the
 * engine had quietly decided there is only ever one node.
 *
 * ## The TTL, and why it is here rather than in a scheduler
 *
 * Presence expires. The engine keeps a per-socket timer for the ordinary case,
 * because an in-memory timer is immediate and costs nothing, but a node that
 * dies takes its timers with it and would leave ghosts standing in rooms
 * forever. So the store carries a TTL as a backstop: `touch` pushes it out on
 * every heartbeat, and anything past it is gone whether or not a timer ever
 * fired. The memory store prunes when it is read, so there is still nothing
 * running in the background. That is the whole reason the engine has no
 * scheduler and no job queue.
 */
export interface PresenceStore {
  /** One person in one office, or null when they are not present. */
  get(officeId: string, userId: string): Promise<Presence | null>

  /** Everyone in the office. The snapshot a client gets on entry. */
  list(officeId: string): Promise<Presence[]>

  /** Everyone in one room, in arrival order, so avatars do not shuffle. */
  listRoom(officeId: string, roomId: string): Promise<Presence[]>

  /**
   * Write the record. Creates or replaces, and resets the TTL.
   *
   * Replace rather than merge: the caller has just resolved what the record
   * should be, and a merge here would let two nodes interleave halves of two
   * different decisions.
   */
  put(presence: Presence): Promise<void>

  /** End someone's presence. Idempotent, because a leave can arrive twice. */
  remove(officeId: string, userId: string): Promise<void>

  /**
   * The heartbeat: this device is still there.
   *
   * Pushes out the TTL and records when the device was last seen, which is what
   * the grace period is measured from.
   */
  touch(officeId: string, userId: string, connectionId: string, at: string): Promise<void>

  /**
   * Which office this person is present in, if any.
   *
   * Presence is one office at a time, so entering a second office has to end the
   * first, and the engine has to be able to ask without scanning every office.
   */
  officeOf(userId: string): Promise<string | null>

  /**
   * The next event number for this office.
   *
   * Every broadcast carries one, so a client that misses an event sees the gap
   * and asks for a fresh snapshot instead of drawing state that is quietly
   * wrong. It has to be allocated by the store, because in unityofis the
   * clients receiving the sequence are spread across nodes.
   */
  nextSequence(officeId: string): Promise<number>

  /** The current sequence, for stamping a snapshot without consuming a number. */
  currentSequence(officeId: string): Promise<number>

  /** Every locked room in the office. */
  locks(officeId: string): Promise<RoomLock[]>

  /**
   * Lock a room, if it is not already locked.
   *
   * Returns the lock either way, so a second person pressing lock is told who
   * holds it rather than being refused for no visible reason.
   */
  lock(officeId: string, lock: RoomLock): Promise<RoomLock>

  /** Unlock. Idempotent: unlocking an open room is not an error. */
  unlock(officeId: string, roomId: string): Promise<void>

  /** Knocks waiting on a room, expired ones already dropped. */
  knocks(officeId: string, roomId: string): Promise<Knock[]>

  /** Record a knock. Replaces any earlier one from the same person. */
  knock(officeId: string, knock: Knock): Promise<void>

  /** Remove a knock, whether it was admitted, declined or withdrawn. */
  clearKnock(officeId: string, knockId: string): Promise<void>

  /**
   * Everything about an office, gone.
   *
   * Used when the last person leaves and by tests. In the memory store it is
   * what stops a long-running process accumulating empty offices.
   */
  clearOffice(officeId: string): Promise<void>
}

/** How long a presence record survives without a heartbeat. */
export const PRESENCE_TTL_MS = 90 * 1000

/**
 * How long somebody stays in their room after their last device drops.
 *
 * Long enough to cover a laptop sleeping, a train tunnel and a wifi handover;
 * short enough that somebody who really has gone does not haunt a room. It
 * lives beside the TTL because the two are the same idea at different scales:
 * this one is the timer, the TTL is the backstop for when the timer's process
 * is no longer there to fire it.
 */
export const DISCONNECT_GRACE_MS = 30 * 1000
