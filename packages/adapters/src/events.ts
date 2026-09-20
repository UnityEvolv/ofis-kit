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
}

/** The office's layout was edited and every client should re-read it. */
export interface TemplateChanged {
  type: 'template.changed'
  officeId: string
}

export type HostEvent = AccessRevoked | ExternalStatusChanged | TemplateChanged

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
