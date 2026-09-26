/**
 * Things the host wants to push into a running office.
 *
 * The engine is otherwise driven entirely by its sockets: a client asks, the
 * core answers. This is the one way in from outside, and it exists for the case
 * the socket cannot cover — something has changed about a person that the person
 * is not going to tell us about.
 *
 * The free office has no publisher at all, so nothing is ever pushed and the
 * whole mechanism costs nothing. unityofis binds it to a Redis pub/sub bridge,
 * so its identity service can end someone's access on a connection that is open
 * right now, without a message broker between them.
 */

/**
 * Someone's access has ended: membership revoked, account suspended, session
 * signed out elsewhere.
 *
 * Revocation is immediate. The alternative is a socket that keeps working until
 * its credential expires, which is a person still standing in a room they have
 * just been removed from.
 */
export interface AccessRevoked {
  type: 'access.revoked'
  userId: string
  /** Shown to them as they are disconnected, so it is not a silent drop. */
  reason: string
}

/**
 * A host-set status changed, such as a calendar meeting starting.
 *
 * The engine cannot work this out: it has no calendar. It is told, and it
 * broadcasts the change like any other status.
 */
export interface ExternalStatusChanged {
  type: 'status.external'
  userId: string
  status: 'in_meeting' | null
  /**
   * Whether the status also silences interruptions, the way do not disturb
   * does. Absent means it does not.
   */
  quiet?: boolean
}

/**
 * The office's layout was edited and every client should re-read it.
 *
 * The engine reads the template again when this arrives, so the host clears
 * whatever it caches first. Anybody standing in a room the edit removed is
 * moved to the break room and told why.
 */
export interface TemplateChanged {
  type: 'template.changed'
  officeId: string
}

/**
 * The answer to "may this person be here" may have changed.
 *
 * Not a verdict: the host says only that something changed, and the engine
 * asks its identity adapter again, the same questions it asks at the door. So
 * the rules stay in one place. Somebody who may no longer be in the office is
 * disconnected; somebody who may no longer be in their room is moved to
 * reception. Either way they are told `reason`, never dropped silently.
 *
 * Without `userId`, everybody in the office is asked about: an office closed
 * or a rule changed for all of them. Without `officeId`, every office is.
 */
export interface AccessChanged {
  type: 'access.changed'
  officeId?: string
  userId?: string
  /** Shown to whoever it moves or disconnects. */
  reason: string
}

export type HostEvent = AccessRevoked | ExternalStatusChanged | TemplateChanged | AccessChanged

export type HostEventHandler = (event: HostEvent) => void

/**
 * A one-way channel from the host into the core.
 *
 * Subscribe returns its own unsubscribe, rather than an off() taking the handler
 * back, because the caller is a connection lifecycle and the thing it wants to
 * hold is "how to stop", not "what I passed in".
 */
export interface EventBus {
  subscribe(handler: HostEventHandler): () => void
  publish(event: HostEvent): void
}

/**
 * A bus with nothing on the other end.
 *
 * What the free office uses. Subscribing succeeds and nothing ever arrives,
 * which is exactly right: the engine does not have to know whether its host has
 * anything to say.
 */
export function silentEventBus(): EventBus {
  return {
    subscribe() {
      return () => {}
    },
    publish() {},
  }
}

/**
 * A bus within one process.
 *
 * Used by tests, and by a host that wants to push an event from its own HTTP
 * layer into the socket layer beside it.
 */
export function localEventBus(): EventBus {
  const handlers = new Set<HostEventHandler>()
  return {
    subscribe(handler) {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    publish(event) {
      // Copied first: a handler that unsubscribes itself while being called
      // would otherwise change the set mid-iteration.
      for (const handler of [...handlers]) handler(event)
    },
  }
}
