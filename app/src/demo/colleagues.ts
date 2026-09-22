import { createOfisClient, type OfisClient } from '@unityevolv/ofiskit-realtime-client'
import type { Template } from '@unityevolv/ofiskit-template'

import { channelSocket } from './socket.js'

/**
 * Simulated colleagues, so the demo is an office and not an empty floor plan.
 *
 * Each one is an ordinary client of the office — the same `createOfisClient` a
 * browser uses, over the same channel as every tab — driven by a small script
 * instead of a person. The office cannot tell them from anybody else, which is
 * the point: what they do is what the product does.
 *
 * They say what they are in their names, so nobody mistakes one for a person.
 * They wander between rooms, go away and come back, set a custom status, and when
 * somebody locks a room, one of them knocks on it a few seconds later — which is
 * the feature that is otherwise hardest to try on your own.
 *
 * They run in the tab hosting the office and stop with it. The next host starts
 * its own, so there are never two of the same colleague.
 */

interface Colleague {
  email: string
  name: string
  /** Where they start the day. */
  prefers: 'workspace' | 'break'
  custom?: { text: string; emoji: string }
}

const COLLEAGUES: Colleague[] = [
  {
    email: 'maya@example.com',
    name: 'Maya Bot',
    prefers: 'workspace',
    custom: { text: 'Heads down on the roadmap', emoji: '🗺️' },
  },
  { email: 'leo@example.com', name: 'Leo Bot', prefers: 'break' },
  {
    email: 'priya@example.com',
    name: 'Priya Bot',
    prefers: 'workspace',
    custom: { text: 'Reviewing pull requests', emoji: '👀' },
  },
]

/** How long a colleague stays put, at least and at most. */
const STAY_MS: [number, number] = [18_000, 45_000]
/** How long after somebody locks a room before a colleague knocks on it. */
const KNOCK_AFTER_MS = 4_000

const between = ([low, high]: [number, number]) => low + Math.random() * (high - low)
const pick = <T>(items: readonly T[]): T | undefined =>
  items[Math.floor(Math.random() * items.length)]

export function startColleagues(options: {
  channel: string
  template: Template
  /** Shorter in tests, which should not wait on a colleague's coffee. */
  timing?: { stayMs?: [number, number]; knockAfterMs?: number }
}): { stop(): void } {
  const stayMs = options.timing?.stayMs ?? STAY_MS
  const knockAfterMs = options.timing?.knockAfterMs ?? KNOCK_AFTER_MS
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const clients: OfisClient[] = []
  const botIds = new Set<string>()
  let stopped = false

  const later = (ms: number, run: () => void) => {
    const timer = setTimeout(() => {
      timers.delete(timer)
      if (!stopped) run()
    }, ms)
    timers.add(timer)
  }

  const rooms = options.template.rooms
  const workspaces = rooms.filter((room) => room.type === 'workspace')
  const breakRoom = rooms.find((room) => room.type === 'break')

  for (const [index, colleague] of COLLEAGUES.entries()) {
    const deviceId = `demo-colleague-${index}`
    const client = createOfisClient({
      url: 'demo',
      deviceId,
      connect: () => channelSocket({ channel: options.channel, deviceId }),
    })
    clients.push(client)

    const lockedRooms = () => client.state().locks
    const here = () => client.state().people.get(client.state().you.userId)?.roomId ?? null

    /** One thing a colleague might do next, then a pause before the one after. */
    const wander = () => {
      const roll = Math.random()
      const open = workspaces.filter((room) => !lockedRooms().has(room.id) && room.id !== here())

      if (roll < 0.55) {
        const room = pick(open)
        if (room) void client.joinRoom(room.id)
      } else if (roll < 0.75) {
        if (breakRoom && here() !== breakRoom.id) void client.joinRoom(breakRoom.id)
      } else if (roll < 0.87) {
        const away = client.state().you.manual === 'away'
        void client.setStatus(away ? null : 'away')
      } else if (colleague.custom) {
        const showing = client.state().people.get(client.state().you.userId)?.custom
        void client.setCustomStatus(showing ? null : colleague.custom)
      }

      later(between(stayMs), wander)
    }

    // Let in by somebody who was knocked on: walk in, as a person would.
    client.on((event) => {
      if (event.type === 'admitted') void client.joinRoom(event.roomId)
    })

    void client.enter({ email: colleague.email, name: colleague.name }).then((result) => {
      if (!result.ok || stopped) return
      botIds.add(result.snapshot.you.userId)

      const start = colleague.prefers === 'break' ? breakRoom : pick(workspaces)
      if (start) void client.joinRoom(start.id)
      if (colleague.custom && index === 0) void client.setCustomStatus(colleague.custom)

      // Staggered, so they do not all move at once and look like a script.
      later(between(stayMs) + index * 5_000, wander)
    })
  }

  /*
   * A knock on any room a person locks.
   *
   * Watched through the first colleague's view of the office, which is everybody's
   * view: a lock is office-wide news. Each lock is knocked on once, by whichever
   * colleague is not already inside, so locking a room is answered by a knock you
   * can admit or decline.
   */
  const knocked = new Set<string>()
  const watcher = clients[0]
  watcher?.subscribe((state) => {
    for (const [roomId, lockedBy] of state.locks) {
      if (knocked.has(roomId) || botIds.has(lockedBy)) continue
      knocked.add(roomId)
      later(knockAfterMs, () => {
        const outside = clients.find(
          (one) => one.state().people.get(one.state().you.userId)?.roomId !== roomId,
        )
        void outside?.knock(roomId)
      })
    }
    // Unlocked again: a later lock of the same room gets its own knock.
    for (const roomId of [...knocked]) if (!state.locks.has(roomId)) knocked.delete(roomId)
  })

  return {
    stop() {
      stopped = true
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
      for (const client of clients) client.close()
    },
  }
}
