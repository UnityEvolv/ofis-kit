import {
  memoryRateLimiter,
  staticTemplateSource,
  typedEmailIdentity,
} from '@unityevolv/ofiskit-adapters/portable'
import { MemoryPresenceStore } from '@unityevolv/ofiskit-presence-store'
import {
  OfficeEngine,
  bindConnection,
  builtInProvider,
  silentLogger,
  type ConnectionSocket,
  type Transport,
} from '@unityevolv/ofiskit-realtime-core/portable'
import type { Template } from '@unityevolv/ofiskit-template'

import type { DemoMessage, ToClient } from './channel.js'

/**
 * The office, run by one tab instead of a server.
 *
 * This is the same engine the Node server runs, wired to the same adapters the
 * free office uses — the typed-email identity, the memory store, the memory rate
 * limiter, the built-in peer-to-peer provider — and to the same event mapping,
 * `bindConnection`. The only thing that differs is how events travel: over a
 * BroadcastChannel between tabs, in place of Socket.IO between browsers and a
 * process. So what the demo shows is the product, not an imitation of it.
 *
 * The provider hands out no ICE servers. Every participant is a tab on this
 * machine, and two peers on one machine connect directly, with no STUN and no
 * relay: nothing in the demo leaves the device.
 */

interface HostedConnection {
  handlers: Map<string, Set<(...args: unknown[]) => void>>
  groups: Set<string>
}

export interface DemoHost {
  /** Stop hosting: every connection is told, and the engine closes. */
  close(): Promise<void>
}

export function startDemoHost(options: {
  channel: string
  officeId: string
  template: Template
}): DemoHost {
  const hostId = globalThis.crypto.randomUUID()
  const channel = new BroadcastChannel(options.channel)
  const store = new MemoryPresenceStore()
  const connections = new Map<string, HostedConnection>()
  /** Who is in each group, which is what Socket.IO's rooms are for on the server. */
  const groups = new Map<string, Set<string>>()

  const send = (message: ToClient) => channel.postMessage(message)
  const toGroup = (group: string, event: string, args: unknown[]) => {
    const members = [...(groups.get(group) ?? [])]
    if (members.length > 0) send({ kind: 'event', to: members, event, args })
  }

  const drop = (conn: string) => {
    const connection = connections.get(conn)
    if (!connection) return
    connections.delete(conn)
    for (const group of connection.groups) groups.get(group)?.delete(conn)
    for (const handler of connection.handlers.get('disconnect') ?? []) handler()
  }

  const transport: Transport = {
    toOffice(officeId, event, payload) {
      toGroup(`office:${officeId}`, event, [payload])
    },
    toRoom(officeId, roomId, event, payload) {
      // As the server does: ask the store who is in the room, then reach each
      // person's devices, rather than keeping a second record of rooms in step.
      void store.listRoom(officeId, roomId).then((people) => {
        for (const person of people) toGroup(`user:${person.userId}`, event, [payload])
      })
    },
    toUser(userId, event, payload) {
      toGroup(`user:${userId}`, event, [payload])
    },
    toConnection(connectionId, event, payload) {
      send({ kind: 'event', to: [connectionId], event, args: [payload] })
    },
    close(connectionId, reason) {
      send({ kind: 'event', to: [connectionId], event: 'disconnected', args: [reason] })
      drop(connectionId)
    },
  }

  const engine = new OfficeEngine({
    officeId: options.officeId,
    store,
    identity: typedEmailIdentity(),
    templates: staticTemplateSource(options.template),
    transport,
    limiter: memoryRateLimiter(),
    provider: builtInProvider({ iceServersFor: () => [] }),
    logger: silentLogger(),
  })

  function open(conn: string, deviceId: string, device: 'web' | 'desktop' | 'mobile') {
    if (!connections.has(conn)) {
      const connection: HostedConnection = { handlers: new Map(), groups: new Set() }
      connections.set(conn, connection)

      const socket: ConnectionSocket = {
        id: conn,
        on(event, handler) {
          if (!connection.handlers.has(event)) connection.handlers.set(event, new Set())
          connection.handlers.get(event)?.add(handler)
        },
        join(group) {
          connection.groups.add(group)
          if (!groups.has(group)) groups.set(group, new Set())
          groups.get(group)?.add(conn)
        },
      }

      engine.connected({ connectionId: conn, deviceId, kind: device })
      bindConnection(socket, engine, options.officeId, silentLogger())
    }
    send({ kind: 'welcome', to: conn, host: hostId })
  }

  channel.onmessage = (event: MessageEvent<DemoMessage>) => {
    const message = event.data
    switch (message.kind) {
      case 'hello':
        open(message.conn, message.deviceId, message.device)
        return
      case 'emit': {
        const handlers = connections.get(message.conn)?.handlers.get(message.event)
        if (!handlers) return
        const { ack } = message
        const args =
          ack === undefined
            ? message.args
            : [
                ...message.args,
                (result: unknown) => send({ kind: 'ack', to: message.conn, ack, result }),
              ]
        for (const handler of handlers) handler(...args)
        return
      }
      case 'bye':
        drop(message.conn)
        return
      default:
        // Messages from the host to tabs, including this one's own: not for it.
        return
    }
  }

  // Tell every tab already open that the office is here, so each says hello.
  send({ kind: 'host', host: hostId })

  return {
    async close() {
      for (const conn of [...connections.keys()]) drop(conn)
      await engine.close()
      channel.close()
    },
  }
}
