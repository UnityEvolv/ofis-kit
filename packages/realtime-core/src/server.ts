import type { Server as HttpServer } from 'node:http'

import type { PresenceStore } from '@unityevolv/ofiskit-presence-store'
import { Server, type ServerOptions } from 'socket.io'

import { bindConnection } from './connection.js'
import { OfficeEngine, type OfficeEngineOptions } from './engine.js'
import { silentLogger, type Logger } from './logger.js'
import type { DeviceKind } from './protocol/index.js'
import type { Transport } from './transport.js'

/**
 * Socket.IO, wired to the engine.
 *
 * Everything in this file is plumbing: it turns socket events into engine calls
 * and engine output back into socket sends. No rule lives here, which is the
 * point — the rules are in the engine, where they can be tested without a
 * network. Which event becomes which engine call is in `connection.ts`, shared
 * with any other transport, so this file is only what is particular to Socket.IO.
 */

export function createSocketTransport(io: Server, store: PresenceStore, logger: Logger): Transport {
  return {
    toOffice(officeId, event, payload) {
      io.to(`office:${officeId}`).emit(event, payload)
    },

    /**
     * Ask the store who is in the room rather than keeping Socket.IO rooms in
     * step as people move. Keeping them in step means updating every one of a
     * person's sockets on every move and getting it right on reconnects and
     * disconnects; asking costs one lookup on the rare events that need it.
     */
    toRoom(officeId, roomId, event, payload) {
      void store
        .listRoom(officeId, roomId)
        .then((people) => {
          for (const person of people) io.to(`user:${person.userId}`).emit(event, payload)
        })
        .catch((cause: unknown) => {
          logger.error('could not reach a room', {
            officeId,
            roomId,
            code: cause instanceof Error ? cause.name : 'unknown',
          })
        })
    },

    toUser(userId, event, payload) {
      // Every device the person has open, because presence is per user.
      io.to(`user:${userId}`).emit(event, payload)
    },

    toConnection(connectionId, event, payload) {
      io.to(connectionId).emit(event, payload)
    },

    close(connectionId, reason) {
      const socket = io.sockets.sockets.get(connectionId)
      if (!socket) return
      // Tell them why first. A socket that just goes quiet is indistinguishable
      // from a network fault, and the client would sit there retrying.
      socket.emit('disconnected', reason)
      socket.disconnect(true)
    },
  }
}

export interface RealtimeServerOptions extends Omit<OfficeEngineOptions, 'transport'> {
  httpServer: HttpServer
  /** Where the socket is served. Configuration, never a literal. */
  path?: string
  /** Origins allowed to connect. The host supplies them; none are written here. */
  allowedOrigins?: string[]
  /**
   * The Socket.IO adapter.
   *
   * None in the free office, which is one process. unityofis passes the Redis
   * adapter, and that is the entire difference between one node and many.
   */
  adapter?: ServerOptions['adapter']
}

export interface RealtimeServer {
  io: Server
  engine: OfficeEngine
  /** For a health endpoint. Cheap enough to call on every probe. */
  health(): Promise<{ status: 'ok'; sockets: number; people: number; uptimeMs: number }>
  /** Stop taking work, let what is in flight finish, then close. */
  close(): Promise<void>
}

export function createRealtimeServer(options: RealtimeServerOptions): RealtimeServer {
  const logger = options.logger ?? silentLogger()
  const startedAt = Date.now()

  const io = new Server(options.httpServer, {
    path: options.path ?? '/socket',
    ...(options.allowedOrigins ? { cors: { origin: options.allowedOrigins } } : {}),
    ...(options.adapter ? { adapter: options.adapter } : {}),
  })

  const transport = createSocketTransport(io, options.store, logger)
  const engine = new OfficeEngine({ ...options, transport })

  io.on('connection', (socket) => {
    const auth = socket.handshake.auth as { deviceId?: unknown; kind?: unknown }
    const deviceId = typeof auth?.deviceId === 'string' ? auth.deviceId : socket.id
    const kind: DeviceKind = auth?.kind === 'mobile' || auth?.kind === 'desktop' ? auth.kind : 'web'

    engine.connected({ connectionId: socket.id, deviceId, kind })
    bindConnection(socket, engine, options.officeId, logger)
  })

  return {
    io,
    engine,

    async health() {
      const people = await options.store.list(options.officeId)
      return {
        status: 'ok',
        sockets: io.sockets.sockets.size,
        people: people.length,
        uptimeMs: Date.now() - startedAt,
      }
    },

    async close() {
      await engine.close()
      await new Promise<void>((resolve) => {
        io.close(() => resolve())
      })
    },
  }
}
