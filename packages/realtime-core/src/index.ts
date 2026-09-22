/**
 * The office engine: presence over one socket.
 *
 * AGPL-3.0. The interfaces it talks to — the presence store, the identity
 * adapter, the template source — are Apache-2.0 and live in their own packages,
 * so building against this is not a licensing decision even though extending it
 * is.
 *
 * A host wires it up and adds configuration, never code. The free office passes
 * the memory store and the typed-email adapter; unityofis passes Redis and its
 * membership adapter. Everything else is identical, which is the property the
 * whole architecture is arranged to have.
 */
export * from './portable.js'

export {
  createRealtimeServer,
  createSocketTransport,
  type RealtimeServer,
  type RealtimeServerOptions,
} from './server.js'

/**
 * TURN credentials for a relay the host runs, minted with an HMAC from
 * `node:crypto` — which is why they are here and not in the portable entry.
 */
export {
  DEFAULT_TURN_TTL_SECONDS,
  hasTurn,
  iceServersFor,
  mintTurnCredential,
  verifyTurnCredential,
  type TurnCredential,
  type TurnOptions,
} from './turn.js'
