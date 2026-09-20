import { PRESENCE_TTL_MS, type PresenceStore } from './store.js'
import type { Knock, Presence, RoomLock } from './types.js'

/**
 * The in-memory presence store: one office, one process, nothing persisted.
 *
 * This is what makes the free office honest. Restart the server and everyone
 * reconnects to an empty office, because there was never anywhere for the office
 * to be kept. unityofis swaps this for Redis and changes nothing else.
 *
 * Two things it does deliberately:
 *
 * **It prunes when read, not on a timer.** There is no scheduler in the engine,
 * so a record past its TTL disappears the next time anybody looks. The cost is a
 * sweep on read; the benefit is one less thing running that can be left running.
 *
 * **It copies on the way in and out.** The engine holds presence records while
 * it decides what to do with them, and a store that handed out its own objects
 * would let a half-finished decision become visible to the next reader.
 */
export class MemoryPresenceStore implements PresenceStore {
  /** officeId → userId → record. */
  readonly #offices = new Map<string, Map<string, Presence>>()
  /** userId → officeId, because presence is one office at a time. */
  readonly #userOffice = new Map<string, string>()
  /** officeId → userId → when the record expires without a heartbeat. */
  readonly #expiry = new Map<string, Map<string, number>>()
  readonly #locks = new Map<string, Map<string, RoomLock>>()
  readonly #knocks = new Map<string, Map<string, Knock>>()
  readonly #sequence = new Map<string, number>()

  readonly #ttlMs: number
  readonly #now: () => number

  /** `now` is injectable so tests can move time without waiting for it. */
  constructor(options: { ttlMs?: number; now?: () => number } = {}) {
    this.#ttlMs = options.ttlMs ?? PRESENCE_TTL_MS
    this.#now = options.now ?? (() => Date.now())
  }

  /**
   * Drop anything in this office whose TTL has passed.
   *
   * The backstop for a node that died mid-timer. In this store the node dying
   * takes the whole office with it, so this mostly matters as the shape the
   * Redis implementation has to match.
   */
  #prune(officeId: string): Map<string, Presence> {
    const office = this.#offices.get(officeId)
    if (!office) return new Map()

    const expiry = this.#expiry.get(officeId)
    if (expiry) {
      const now = this.#now()
      for (const [userId, at] of expiry) {
        if (at > now) continue
        office.delete(userId)
        expiry.delete(userId)
        if (this.#userOffice.get(userId) === officeId) this.#userOffice.delete(userId)
      }
    }

    // A lock outlives nobody. When the last person in a room goes, however they
    // went, the room unlocks; otherwise a dropped connection leaves a room
    // locked with nobody in it and no way back in.
    const locks = this.#locks.get(officeId)
    if (locks) {
      for (const [roomId] of locks) {
        const stillInside = [...office.values()].some((presence) => presence.roomId === roomId)
        if (!stillInside) locks.delete(roomId)
      }
    }

    const knocks = this.#knocks.get(officeId)
    if (knocks) {
      const now = this.#now()
      for (const [id, knock] of knocks) {
        if (Date.parse(knock.expiresAt) <= now) knocks.delete(id)
      }
    }

    return office
  }

  #clone(presence: Presence): Presence {
    return { ...presence, devices: presence.devices.map((device) => ({ ...device })) }
  }

  async get(officeId: string, userId: string): Promise<Presence | null> {
    const found = this.#prune(officeId).get(userId)
    return found ? this.#clone(found) : null
  }

  async list(officeId: string): Promise<Presence[]> {
    return [...this.#prune(officeId).values()].map((presence) => this.#clone(presence))
  }

  async listRoom(officeId: string, roomId: string): Promise<Presence[]> {
    return [...this.#prune(officeId).values()]
      .filter((presence) => presence.roomId === roomId)
      // Arrival order, so an avatar keeps its cell while others come and go.
      // Ties break on user id purely so the order is stable rather than
      // whatever insertion happened to be.
      .sort((a, b) => a.arrivedAt.localeCompare(b.arrivedAt) || a.userId.localeCompare(b.userId))
      .map((presence) => this.#clone(presence))
  }

  async put(presence: Presence): Promise<void> {
    const office = this.#offices.get(presence.officeId) ?? new Map<string, Presence>()
    this.#offices.set(presence.officeId, office)
    office.set(presence.userId, this.#clone(presence))

    this.#userOffice.set(presence.userId, presence.officeId)

    const expiry = this.#expiry.get(presence.officeId) ?? new Map<string, number>()
    this.#expiry.set(presence.officeId, expiry)
    expiry.set(presence.userId, this.#now() + this.#ttlMs)
  }

  async remove(officeId: string, userId: string): Promise<void> {
    this.#offices.get(officeId)?.delete(userId)
    this.#expiry.get(officeId)?.delete(userId)
    if (this.#userOffice.get(userId) === officeId) this.#userOffice.delete(userId)
    // Re-prune so a room that just emptied unlocks itself immediately rather
    // than at the next read.
    this.#prune(officeId)
  }

  async touch(officeId: string, userId: string, connectionId: string, at: string): Promise<void> {
    const presence = this.#offices.get(officeId)?.get(userId)
    if (!presence) return

    const device = presence.devices.find((candidate) => candidate.connectionId === connectionId)
    if (device) device.lastSeenAt = at

    const expiry = this.#expiry.get(officeId) ?? new Map<string, number>()
    this.#expiry.set(officeId, expiry)
    expiry.set(userId, this.#now() + this.#ttlMs)
  }

  async officeOf(userId: string): Promise<string | null> {
    const officeId = this.#userOffice.get(userId)
    if (!officeId) return null
    // Prune first: a stale mapping would send the engine to end presence in an
    // office the person has already expired out of.
    return this.#prune(officeId).has(userId) ? officeId : null
  }

  async nextSequence(officeId: string): Promise<number> {
    const next = (this.#sequence.get(officeId) ?? 0) + 1
    this.#sequence.set(officeId, next)
    return next
  }

  async currentSequence(officeId: string): Promise<number> {
    return this.#sequence.get(officeId) ?? 0
  }

  async locks(officeId: string): Promise<RoomLock[]> {
    this.#prune(officeId)
    return [...(this.#locks.get(officeId)?.values() ?? [])].map((lock) => ({ ...lock }))
  }

  async lock(officeId: string, lock: RoomLock): Promise<RoomLock> {
    this.#prune(officeId)
    const locks = this.#locks.get(officeId) ?? new Map<string, RoomLock>()
    this.#locks.set(officeId, locks)
    const existing = locks.get(lock.roomId)
    if (existing) return { ...existing }
    locks.set(lock.roomId, { ...lock })
    return { ...lock }
  }

  async unlock(officeId: string, roomId: string): Promise<void> {
    this.#locks.get(officeId)?.delete(roomId)
  }

  async knocks(officeId: string, roomId: string): Promise<Knock[]> {
    this.#prune(officeId)
    return [...(this.#knocks.get(officeId)?.values() ?? [])]
      .filter((knock) => knock.roomId === roomId)
      .map((knock) => ({ ...knock }))
  }

  async knock(officeId: string, knock: Knock): Promise<void> {
    const knocks = this.#knocks.get(officeId) ?? new Map<string, Knock>()
    this.#knocks.set(officeId, knocks)
    // One knock per person per room: knocking again is impatience, not a second
    // request, and the room should not fill up with the same name.
    for (const [id, existing] of knocks) {
      if (existing.roomId === knock.roomId && existing.userId === knock.userId) knocks.delete(id)
    }
    knocks.set(knock.id, { ...knock })
  }

  async clearKnock(officeId: string, knockId: string): Promise<void> {
    this.#knocks.get(officeId)?.delete(knockId)
  }

  async clearOffice(officeId: string): Promise<void> {
    for (const userId of this.#offices.get(officeId)?.keys() ?? []) {
      if (this.#userOffice.get(userId) === officeId) this.#userOffice.delete(userId)
    }
    this.#offices.delete(officeId)
    this.#expiry.delete(officeId)
    this.#locks.delete(officeId)
    this.#knocks.delete(officeId)
    this.#sequence.delete(officeId)
  }
}
