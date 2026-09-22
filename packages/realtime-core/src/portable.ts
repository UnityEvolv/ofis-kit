/**
 * The office engine, without the network: everything here runs in Node, in a
 * browser and on a phone.
 *
 * The main entry point is this plus the two things that are Node's alone — the
 * Socket.IO server, and the TURN credentials that need `node:crypto`. A host
 * that is not a Node process (the demo runs the whole office in a browser tab)
 * imports this, passes its own `Transport`, and wires connections to the engine
 * with `bindConnection`, which is the same mapping the Socket.IO server uses.
 */
export { OfficeEngine, type OfficeEngineOptions } from './engine.js'

export type { Transport } from './transport.js'
export { bindConnection, type ConnectionSocket } from './connection.js'

/**
 * Exported because a host running many nodes wants to tune the window, and
 * because unityofis's tests assert on coalescing without standing up a socket.
 */
export { Broadcaster, DIFF_WINDOW_MS } from './broadcast.js'

/**
 * The provider interface, server half, and the call model.
 *
 * A host passes a plugin and binds whatever hooks it has a database for. The
 * built-in peer-to-peer provider is the reference implementation, and adding a
 * second one means writing these methods and a client adapter and touching no
 * call, presence or UI code.
 */

export {
  CallRegistry,
  builtInProvider,
  type BuiltInProviderOptions,
  type CallContext,
  type CallHooks,
  type CallLeg,
  type LiveCall,
  type ParticipantContext,
  type ParticipantCredentials,
  type ProviderCost,
  type ProviderLimits,
  type RtcServerPlugin,
} from './calls.js'

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
