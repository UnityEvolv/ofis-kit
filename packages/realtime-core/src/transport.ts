import type { ErrorEnvelope } from '@unityevolv/ofiskit-template'

/**
 * How anything leaves the engine.
 *
 * The core never imports Socket.IO. It calls these methods, and the host wires
 * them to whatever it is actually running on. That is what makes the rules
 * testable without a network, and it is why unityofis can run the same core
 * with the Redis adapter underneath and change nothing above.
 */
export interface Transport {
  /** Everyone in the office. Visibility is uniform; only the controls differ. */
  toOffice(officeId: string, event: string, payload: unknown): void
  /** Everyone in one room, for things only the room cares about. */
  toRoom(officeId: string, roomId: string, event: string, payload: unknown): void
  /** Every device one person has open, because presence is per user. */
  toUser(userId: string, event: string, payload: unknown): void
  /** One socket, for a refusal meant only for whoever asked. */
  toConnection(connectionId: string, event: string, payload: unknown): void
  /** Close a socket, having told it why. Never a silent drop. */
  close(connectionId: string, reason: ErrorEnvelope): void
}
