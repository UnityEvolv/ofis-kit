import type { OfficeEngine } from './engine.js'
import type { Logger } from './logger.js'
import { Refusal } from './protocol/index.js'

/**
 * One connection, as far as the event mapping needs to know it.
 *
 * A Socket.IO socket is one; so is a connection over a browser's
 * BroadcastChannel, which is how the demo runs the whole office in a tab. Both
 * get the same mapping from this file, so a transport is a way of carrying
 * events and never a second copy of which event does what.
 */
export interface ConnectionSocket {
  readonly id: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- what arrives off the wire is untrusted and unshaped; every handler below checks each field it reads rather than trusting a type
  on(event: string, handler: (...args: any[]) => void): unknown
  /** Put this connection in a named group: the office, or one person's devices. */
  join(group: string): unknown
}

/** The one place a socket event becomes an engine call. */
export function bindConnection(
  socket: ConnectionSocket,
  engine: OfficeEngine,
  officeId: string,
  logger: Logger,
): void {
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
          //
          // Which leaves a sliver: a change landing between the snapshot being
          // taken and this join is not delivered. That is what the sequence
          // number is for — the client sees the gap on the next diff and asks
          // for a fresh snapshot, which is cheaper and more honest than holding
          // a lock across an await to make the sliver disappear.
          await socket.join(`office:${result.snapshot.officeId}`)
          await socket.join(`user:${result.snapshot.you.userId}`)
        }
        return result
      },
      'office:enter',
    )
  })

  socket.on('office:leave', (ack) => handle(ack, () => engine.leaveOffice(id), 'office:leave'))

  socket.on('office:resync', (ack) => handle(ack, () => engine.resync(id), 'office:resync'))

  socket.on('room:join', (request, ack) =>
    handle(ack, () => engine.joinRoom(id, String(request?.roomId ?? '')), 'room:join'),
  )
  socket.on('room:leave', (ack) => handle(ack, () => engine.leaveRoom(id), 'room:leave'))

  socket.on('room:lock', (request, ack) =>
    handle(ack, () => engine.lock(id, String(request?.roomId ?? '')), 'room:lock'),
  )
  socket.on('room:unlock', (request, ack) =>
    handle(ack, () => engine.unlock(id, String(request?.roomId ?? '')), 'room:unlock'),
  )
  socket.on('room:knock', (request, ack) =>
    handle(ack, () => engine.knock(id, String(request?.roomId ?? '')), 'room:knock'),
  )
  socket.on('knock:admit', (request, ack) =>
    handle(ack, () => engine.admit(id, String(request?.knockId ?? '')), 'knock:admit'),
  )
  socket.on('knock:decline', (request, ack) =>
    handle(ack, () => engine.decline(id, String(request?.knockId ?? '')), 'knock:decline'),
  )

  socket.on('call:join', (request, ack) =>
    handle(
      ack,
      () =>
        engine.joinCall(id, {
          audio: Boolean(request?.audio),
          video: Boolean(request?.video),
          ...(request?.secondDevice === 'add' ? { secondDevice: 'add' as const } : {}),
        }),
      'call:join',
    ),
  )
  socket.on('call:leave', (ack) => handle(ack, () => engine.leaveCall(id), 'call:leave'))

  // Acknowledged, unlike the media reports below: both are deliberate presses,
  // and both can be refused — so "nothing happened" would not be an answer.
  socket.on('call:hand', (request, ack) =>
    handle(ack, () => engine.raiseHand(id, Boolean(request?.raised)), 'call:hand'),
  )
  socket.on('call:react', (request, ack) =>
    handle(ack, () => engine.react(id, String(request?.reaction ?? '')), 'call:react'),
  )

  // No acknowledgement on any of these: they arrive many times a second while
  // somebody is talking, and nobody waits on them.
  socket.on('call:media', (request) => {
    void engine.setMediaState(id, {
      muted: Boolean(request?.muted),
      cameraOn: Boolean(request?.cameraOn),
      sharing: Boolean(request?.sharing),
    })
  })
  socket.on('call:speaking', (request) => {
    void engine.setSpeaking(id, Boolean(request?.speaking))
  })
  socket.on('call:quality', (request) => {
    void engine.reportQuality(id, {
      peerDeviceId: String(request?.peerDeviceId ?? ''),
      relayed: Boolean(request?.relayed),
      packetLoss: Number(request?.packetLoss) || 0,
      roundTripMs: Number(request?.roundTripMs) || 0,
    })
  })
  // The signalling relay. The core reads the address and nothing else.
  socket.on('signal', (message) => {
    void engine.signal(id, {
      to: String(message?.to ?? ''),
      type: message?.type,
      payload: message?.payload,
    })
  })

  socket.on('call:failed', (request) => {
    void engine.reportCallFailure(id, String(request?.reason ?? 'unknown'))
  })

  socket.on('status:manual', (request, ack) =>
    handle(ack, () => engine.setManualStatus(id, request?.manual ?? null), 'status:manual'),
  )
  socket.on('status:custom', (request, ack) =>
    handle(ack, () => engine.setCustomStatus(id, request?.custom ?? null), 'status:custom'),
  )

  // No acknowledgement: these arrive constantly and nobody waits on them.
  socket.on('device:activity', (request) => {
    void engine.setActivity(id, request)
  })

  socket.on('auth:refresh', (request, ack) =>
    handle(ack, () => engine.refreshAuth(id, request?.credentials), 'auth:refresh'),
  )

  socket.on('heartbeat', (ack) => handle(ack, () => engine.heartbeat(id), 'heartbeat'))

  socket.on('disconnect', () => {
    void engine.disconnected(id)
  })
}
