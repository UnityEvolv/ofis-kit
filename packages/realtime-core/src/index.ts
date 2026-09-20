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
export { OfficeEngine, type OfficeEngineOptions } from './engine.js'

export {
  createRealtimeServer,
  createSocketTransport,
  type RealtimeServer,
  type RealtimeServerOptions,
} from './server.js'

export type { Transport } from './transport.js'

export { createLogger, silentLogger, type LogFields, type LogLevel, type Logger } from './logger.js'

/**
 * Ids are made in one place, for the whole engine.
 *
 * Re-exported from the template package, which is the lowest one and therefore
 * the only one every layer can depend on without a cycle. There is one
 * implementation of UUIDv7 in the workspace, not four.
 */
export { idMintedAt, isId, newId } from '@unityevolv/ofiskit-template'

export * from './protocol/index.js'
