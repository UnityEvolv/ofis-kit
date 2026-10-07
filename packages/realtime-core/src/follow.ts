import type { FollowChange } from '@unityevolv/ofiskit-adapters'

import type { FollowState } from './protocol/index.js'

/**
 * Who follows whom, held in memory.
 *
 * A follow is a link between two people in one office and needs no database: it
 * dies with either of them, which is the correct lifetime. This is the table of
 * those links, the requests waiting for an answer, and the declines that are
 * still cooling off — and nothing else. Every change to it is one `FollowChange`,
 * applied the same way whether it was made on this node or arrived from another,
 * so two nodes holding the same changes hold the same table.
 *
 * No timers here and nothing swept. A request past its expiry and a decline past
 * its cooling-off are ignored by whoever reads them, which is the same rule as a
 * custom status: two instants compared at the moment of use.
 */

/** The tunables of following. */
export interface FollowOptions {
  /** How many people may follow one person at once. */
  maxFollowers: number
  /** How long a declined asker waits before asking the same person again. */
  declineCooldownMs: number
  /** How long a request waits for an answer before it lapses, like a knock. */
  requestTtlMs: number
  /**
   * How long a move waits for a follower's call to end. Past it, the follow
   * stops and the follower is told why, rather than being yanked out of a call
   * or followed around by a move that never happens.
   */
  callWaitMs: number
}

/**
 * The decided limits: five followers per person, ten minutes after a decline.
 *
 * A request lasts a minute, as a knock does, and a move waits two minutes for a
 * call to end — long enough to say goodbye, short enough that a follow nobody is
 * using does not linger.
 */
export const FOLLOW_DEFAULTS: Readonly<FollowOptions> = Object.freeze({
  maxFollowers: 5,
  declineCooldownMs: 10 * 60_000,
  requestTtlMs: 60_000,
  callWaitMs: 2 * 60_000,
})

export interface FollowRequestRecord {
  requestId: string
  followerId: string
  leaderId: string
  expiresAt: number
}

export interface FollowLink {
  followerId: string
  leaderId: string
  since: number
  /** Set while a move is held back by the follower's call. */
  waiting?: { roomId: string; until: number }
}

const pair = (followerId: string, leaderId: string) => `${followerId}:${leaderId}`

export class FollowBook {
  readonly #now: () => number

  constructor(now: () => number = () => Date.now()) {
    this.#now = now
  }

  readonly #requests = new Map<string, FollowRequestRecord>()
  /** followerId → the link. One leader per follower, so the follower is the key. */
  readonly #links = new Map<string, FollowLink>()
  /** follower:leader → until when a new request is refused. */
  readonly #declines = new Map<string, number>()

  /** Apply one change. Idempotent: applying it twice is applying it once. */
  apply(change: FollowChange): void {
    switch (change.op) {
      case 'asked':
        this.#requests.set(change.requestId, {
          requestId: change.requestId,
          followerId: change.followerId,
          leaderId: change.leaderId,
          expiresAt: change.expiresAt,
        })
        return
      case 'unasked':
        this.#requests.delete(change.requestId)
        return
      case 'linked':
        this.#links.set(change.followerId, {
          followerId: change.followerId,
          leaderId: change.leaderId,
          since: change.since,
        })
        // An answer to every request between the two, whichever way round.
        for (const [requestId, request] of this.#requests) {
          if (request.followerId === change.followerId) this.#requests.delete(requestId)
        }
        return
      case 'unlinked':
        this.#links.delete(change.followerId)
        return
      case 'declined':
        // Swept here, as the only place the map grows, so declines nobody is
        // going to repeat do not pile up for the life of the process.
        for (const [key, until] of this.#declines) {
          if (until <= this.#now()) this.#declines.delete(key)
        }
        this.#declines.set(pair(change.followerId, change.leaderId), change.until)
        return
      case 'waiting': {
        const link = this.#links.get(change.followerId)
        if (link) {
          this.#links.set(change.followerId, {
            ...link,
            waiting: { roomId: change.roomId, until: change.until },
          })
        }
        return
      }
      case 'unwaiting': {
        const link = this.#links.get(change.followerId)
        if (link?.waiting) {
          const { waiting: _done, ...rest } = link
          this.#links.set(change.followerId, rest)
        }
        return
      }
    }
  }

  /** The link this person follows by, if they follow anybody. */
  linkOf(followerId: string): FollowLink | null {
    return this.#links.get(followerId) ?? null
  }

  /** Everybody following this person, oldest first. */
  followersOf(leaderId: string): FollowLink[] {
    return [...this.#links.values()]
      .filter((link) => link.leaderId === leaderId)
      .sort((left, right) => left.since - right.since)
  }

  /** A request still waiting for an answer, or null once it has lapsed. */
  request(requestId: string, now: number): FollowRequestRecord | null {
    const found = this.#requests.get(requestId)
    return found && found.expiresAt > now ? found : null
  }

  /** The request this person has out, if any is still waiting. */
  requestFrom(followerId: string, now: number): FollowRequestRecord | null {
    for (const request of this.#requests.values()) {
      if (request.followerId === followerId && request.expiresAt > now) return request
    }
    return null
  }

  /** Every request waiting on this person, lapsed or not, so a leaver can end them all. */
  requestsInvolving(userId: string): FollowRequestRecord[] {
    return [...this.#requests.values()].filter(
      (request) => request.followerId === userId || request.leaderId === userId,
    )
  }

  /** How long until this follower may ask this leader again. Zero means now. */
  cooldownLeft(followerId: string, leaderId: string, now: number): number {
    const until = this.#declines.get(pair(followerId, leaderId)) ?? 0
    return Math.max(0, until - now)
  }

  /** One person's side of all of it, as their own screens see it. */
  stateFor(userId: string, now: number): FollowState {
    const link = this.#links.get(userId)
    const asking = this.requestFrom(userId, now)
    return {
      following: link
        ? {
            userId: link.leaderId,
            since: new Date(link.since).toISOString(),
            ...(link.waiting
              ? {
                  waitingFor: {
                    roomId: link.waiting.roomId,
                    until: new Date(link.waiting.until).toISOString(),
                  },
                }
              : {}),
          }
        : null,
      followers: this.followersOf(userId).map((one) => ({
        userId: one.followerId,
        since: new Date(one.since).toISOString(),
      })),
      asking: asking
        ? {
            requestId: asking.requestId,
            userId: asking.leaderId,
            expiresAt: new Date(asking.expiresAt).toISOString(),
          }
        : null,
    }
  }

  clear(): void {
    this.#requests.clear()
    this.#links.clear()
    this.#declines.clear()
  }
}
