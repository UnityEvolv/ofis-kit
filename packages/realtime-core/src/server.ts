import type { Server as HttpServer } from 'node:http'

import type { PresenceStore } from '@unityevolv/ofiskit-presence-store'
import { Server, type ServerOptions, type Socket } from 'socket.io'

import { OfficeEngine, type OfficeEngineOptions } from './engine.js'
import { silentLogger, type Logger } from './logger.js'
import { Refusal, type DeviceKind } from './protocol/index.js'
import type { Transport } from './transport.js'

/**
 * Socket.IO, wired to the engine.
 *
 * Everything in this file is plumbing: it turns socket events into engine calls
 * and engine output back into socket sends. No rule lives here, which is the
 * point — the rules are in the engine, where they can be tested without a
 * network, and this file is the only thing a different transport would replace.
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
    bind(socket, engine, options.officeId, logger)
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

/** The one place a socket event becomes an engine call. */
function bind(socket: Socket, engine: OfficeEngine, officeId: string, logger: Logger): void {
  const id = socket.id

  /**
   * Run a handler and always acknowledge.
   *
   * A client waiting on an acknowledgement that never arrives cannot tell a
   * refusal from a crash, so an unexpected error becomes a refusal with a code
   * rather than an unhandled rejection and a silent socket.
   */
  const handle = <T>(ack: unknown, run: () => Promise<T>, what: string): void => {
    const reply = typeof ack === 'function' ? (ack as (result: unknown) => void) : () => {}
    void run()
      .then(reply)
      .catch(() => {
        logger.error('handler failed', { connectionId: id, officeId, code: what })
        reply({
          ok: false,
          code: Refusal.MALFORMED,
          message: 'Something went wrong handling that. Please try again.',
        })
      })
  }

  socket.on('office:enter', (request, ack) => {
    handle(
      ack,
      async () => {
        const result = await engine.enter(id, request)
        if (result.ok) {
          // Joined only once authenticated, so an unauthenticated socket never
          // receives anything about anybody.
          await socket.join(`office:${result.snapshot.officeId}`)
          await socket.join(`user:${result.snapshot.you.userId}`)
        }
        return result
      },
      'office:enter',
    )
  })

  socket.on('office:leave', (ack) => handle(ack, () => engine.leaveOffice(id), 'office:leave'))

  socket.on('auth:refresh', (request, ack) =>
    handle(ack, () => engine.refreshAuth(id, request?.credentials), 'auth:refresh'),
  )

  socket.on('heartbeat', (ack) => handle(ack, () => engine.heartbeat(id), 'heartbeat'))

  socket.on('disconnect', () => {
    void engine.disconnected(id)
  })
}
