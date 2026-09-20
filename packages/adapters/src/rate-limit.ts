/**
 * How often somebody may do something.
 *
 * Supplied by the host rather than built in, because the shape of the answer
 * differs: a single process counts in a Map, and a product running many nodes
 * has to count somewhere both nodes can see. The engine only needs to be able
 * to ask, which is the same arrangement as the presence store and for the same
 * reason — a counter per process would silently multiply every limit by the
 * number of nodes.
 *
 * Knocking is the case that made this necessary. A knock interrupts everyone in
 * a room, so somebody knocking twelve times is not persistence, it is a way to
 * make a room unusable.
 */

export interface RateLimitVerdict {
  allowed: boolean
  /** How many more are allowed in this window. */
  remaining: number
  /** When the window resets, so a refusal can say how long to wait. */
  retryAfterMs: number
}

export interface RateLimiter {
  /**
   * Count one attempt against a key and say whether it is allowed.
   *
   * The key is the caller's business: knocks are limited per person per room, so
   * the core passes both. A limiter never invents a key of its own, or two
   * features start sharing a budget by accident.
   *
   * The limit and the window are the caller's too. They belong to the rule, not
   * to the thing counting — the engine knows what a reasonable number of knocks
   * is, and a Redis limiter has no opinion about it.
   */
  take(key: string, limit: number, windowMs: number): Promise<RateLimitVerdict>
}

/**
 * A fixed-window limiter in one process. What the free office uses.
 *
 * A fixed window rather than a sliding one on purpose: sliding means keeping
 * every timestamp, and for a limit like "five knocks a minute" the whole
 * difference is a burst across a window boundary that nobody in the room will
 * notice.
 *
 * Windows are dropped as they are read, so there is nothing running in the
 * background here either. That is the same rule as everywhere else in this
 * repository: no scheduler, and anything expiring is checked at the moment of
 * use.
 */
export function memoryRateLimiter(now: () => number = () => Date.now()): RateLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>()

  return {
    async take(key, limit, windowMs) {
      const at = now()
      const found = windows.get(key)

      if (!found || found.resetAt <= at) {
        // Also the moment to drop windows nobody is using, so a process running
        // for a month does not keep a row for everybody who ever knocked. Only
        // above a threshold, so the ordinary case stays a single Map write.
        if (windows.size > 1000) {
          for (const [candidate, window] of windows) {
            if (window.resetAt <= at) windows.delete(candidate)
          }
        }
        windows.set(key, { count: 1, resetAt: at + windowMs })
        return { allowed: true, remaining: limit - 1, retryAfterMs: windowMs }
      }

      found.count += 1
      return {
        allowed: found.count <= limit,
        remaining: Math.max(0, limit - found.count),
        retryAfterMs: found.resetAt - at,
      }
    },
  }
}

/**
 * A limiter that always says yes.
 *
 * For a test that is about something else, and for a host that has decided the
 * limit belongs somewhere in front of it. Named rather than left as an inline
 * object so that "this is deliberate" is legible at the call site.
 */
export function unlimited(): RateLimiter {
  return {
    async take(_key, limit, windowMs) {
      return { allowed: true, remaining: limit, retryAfterMs: windowMs }
    },
  }
}
