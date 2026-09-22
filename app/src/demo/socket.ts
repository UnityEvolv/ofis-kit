import type { SocketLike } from '@unityevolv/ofiskit-realtime-client'

import type { DemoMessage, ToHost } from './channel.js'

/**
 * A socket to the tab hosting the office, over a BroadcastChannel.
 *
 * It is the client's `SocketLike`, so the client cannot tell it from Socket.IO:
 * `connect` when the host answers, `disconnect` when the host goes away, and
 * events and acknowledgements in both directions. Like Socket.IO it holds what is
 * emitted while there is no host yet and sends it once there is, so the first tab
 * can start its client before it has finished becoming the host.
 */

// Handlers receive whatever the event carries; the client types each one.
type Handler = (...args: never[]) => void

export interface ChannelSocketOptions {
  channel: string
  deviceId: string
}

export function channelSocket(options: ChannelSocketOptions): SocketLike {
  const conn = globalThis.crypto.randomUUID()
  const channel = new BroadcastChannel(options.channel)
  const handlers = new Map<string, Set<Handler>>()
  const manager = new Map<string, Set<Handler>>()
  const pending = new Map<number, (result: unknown) => void>()
  let nextAck = 1
  let connected = false
  let closed = false
  let queued: ToHost[] = []

  const fire = (table: Map<string, Set<Handler>>, event: string, args: unknown[]) => {
    for (const handler of [...(table.get(event) ?? [])]) {
      ;(handler as (...values: unknown[]) => void)(...args)
    }
  }

  const post = (message: ToHost) => {
    if (closed) return
    channel.postMessage(message)
  }

  const hello = () => post({ kind: 'hello', conn, deviceId: options.deviceId, device: 'web' })

  channel.onmessage = (event: MessageEvent<DemoMessage>) => {
    const message = event.data
    switch (message.kind) {
      case 'welcome': {
        if (message.to !== conn || connected) return
        connected = true
        const waiting = queued
        queued = []
        for (const one of waiting) post(one)
        fire(handlers, 'connect', [])
        return
      }
      case 'host': {
        // The office moved to another tab. Everything this connection had is
        // gone with the old host, as it would be with a restarted server.
        if (connected) {
          connected = false
          pending.clear()
          fire(handlers, 'disconnect', [])
          fire(manager, 'reconnect_attempt', [])
        }
        hello()
        return
      }
      case 'event': {
        if (message.to.includes(conn)) fire(handlers, message.event, message.args)
        return
      }
      case 'ack': {
        if (message.to !== conn) return
        pending.get(message.ack)?.(message.result)
        pending.delete(message.ack)
        return
      }
      default:
        // A tab's message to the host: not for a client.
        return
    }
  }

  // A closed tab says so, so the others see the person leave straight away
  // rather than after the presence timeout.
  const leave = () => post({ kind: 'bye', conn })
  globalThis.addEventListener?.('pagehide', leave)

  hello()

  return {
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event)?.add(handler)
      return this
    },

    off(event, handler) {
      handlers.get(event)?.delete(handler)
      return this
    },

    emit(event, ...args) {
      const last = args.at(-1)
      const reply = typeof last === 'function' ? (last as (result: unknown) => void) : null
      const payload = reply ? args.slice(0, -1) : args
      const message: ToHost = { kind: 'emit', conn, event, args: payload }
      if (reply) {
        const ack = nextAck++
        pending.set(ack, reply)
        message.ack = ack
      }
      if (connected) post(message)
      else queued.push(message)
      return this
    },

    disconnect() {
      if (closed) return this
      leave()
      closed = true
      connected = false
      globalThis.removeEventListener?.('pagehide', leave)
      channel.close()
      return this
    },

    io: {
      on(event: string, handler: Handler) {
        if (!manager.has(event)) manager.set(event, new Set())
        manager.get(event)?.add(handler)
        return this
      },
    },
  }
}
