import { beforeEach, describe, expect, it } from 'vitest'

import { MemoryPresenceStore } from './memory.js'
import { isCustomStatusLive, resolveStatus, suppressesInterruption } from './status.js'
import type { DevicePresence, Presence } from './types.js'

const OFFICE = 'office-1'
const iso = (at: number) => new Date(at).toISOString()

let clock = Date.parse('2026-09-20T09:00:00.000Z')
const now = () => clock

function device(overrides: Partial<DevicePresence> = {}): DevicePresence {
  return {
    connectionId: 'socket-1',
    deviceId: 'laptop',
    kind: 'web',
    idle: false,
    foreground: true,
    connectedAt: iso(clock),
    lastSeenAt: iso(clock),
    ...overrides,
  }
}

function presence(overrides: Partial<Presence> = {}): Presence {
  return {
    userId: 'ada',
    officeId: OFFICE,
    roomId: 'reception',
    displayName: 'Ada',
    devices: [device()],
    inCall: false,
    enteredAt: iso(clock),
    arrivedAt: iso(clock),
    ...overrides,
  }
}

describe('resolving a status', () => {
  it('is available with one active device', () => {
    expect(resolveStatus(presence(), clock)).toBe('available')
  })

  it('stays available when one device is idle and another is not', () => {
    // The rule that stops a laptop left open making someone look away while
    // they are typing on their phone.
    const both = presence({
      devices: [
        device({ connectionId: 'a', deviceId: 'laptop', idle: true }),
        device({
          connectionId: 'b',
          deviceId: 'phone',
          kind: 'mobile',
          idle: false,
          foreground: true,
        }),
      ],
    })
    expect(resolveStatus(both, clock)).toBe('available')
  })

  it('is away only when every device is idle or backgrounded', () => {
    const idle = presence({
      devices: [
        device({ connectionId: 'a', idle: true }),
        device({ connectionId: 'b', kind: 'mobile', idle: false, foreground: false }),
      ],
    })
    expect(resolveStatus(idle, clock)).toBe('away')
  })

  it('treats a backgrounded phone as away immediately', () => {
    const phone = presence({
      devices: [device({ kind: 'mobile', idle: false, foreground: false })],
    })
    expect(resolveStatus(phone, clock)).toBe('away')
  })

  it('lets a manual status beat everything automatic', () => {
    const chosen = presence({
      manual: 'dnd',
      inCall: true,
      devices: [device({ idle: true })],
    })
    expect(resolveStatus(chosen, clock)).toBe('dnd')
  })

  it('keeps someone in a call out of away, however idle their keyboard is', () => {
    // Idle detection is suspended during a call on purpose: a person listening
    // is not idle, and a muted person who walked away still reads as in a call.
    const listening = presence({ inCall: true, devices: [device({ idle: true })] })
    expect(resolveStatus(listening, clock)).toBe('in_call')
  })

  it('separates in a meeting from in a call', () => {
    const meeting = presence({ externalStatus: 'in_meeting' })
    expect(resolveStatus(meeting, clock)).toBe('in_meeting')
  })

  it('shows reconnecting during the grace period, then offline', () => {
    const dropped = presence({ devices: [], reconnectingUntil: iso(clock + 30_000) })
    expect(resolveStatus(dropped, clock)).toBe('reconnecting')
    expect(resolveStatus(dropped, clock + 31_000)).toBe('offline')
  })

  it('suppresses interruption on do not disturb without refusing anything', () => {
    // Do not disturb silences a knock; it never stops one arriving.
    expect(suppressesInterruption(presence({ manual: 'dnd' }), clock)).toBe(true)
    expect(suppressesInterruption(presence(), clock)).toBe(false)
  })
})

describe('a custom status', () => {
  it('disappears at its expiry without anything running to clear it', () => {
    const custom = { text: 'Lunch', emoji: '🥪', expiresAt: iso(clock + 60_000) }
    expect(isCustomStatusLive(custom, clock)).toBe(true)
    expect(isCustomStatusLive(custom, clock + 61_000)).toBe(false)
  })

  it('stays until cleared when it has no expiry', () => {
    expect(isCustomStatusLive({ text: 'Working from the shed' }, clock + 1e9)).toBe(true)
  })
})

describe('the memory store', () => {
  let store: MemoryPresenceStore

  beforeEach(() => {
    clock = Date.parse('2026-09-20T09:00:00.000Z')
    store = new MemoryPresenceStore({ ttlMs: 90_000, now })
  })

  it('holds presence for one office at a time', async () => {
    await store.put(presence())
    expect(await store.officeOf('ada')).toBe(OFFICE)

    await store.remove(OFFICE, 'ada')
    expect(await store.officeOf('ada')).toBeNull()
  })

  it('lists a room in arrival order, so avatars keep their cells', async () => {
    await store.put(presence({ userId: 'ada', roomId: 'studio', arrivedAt: iso(clock) }))
    await store.put(presence({ userId: 'grace', roomId: 'studio', arrivedAt: iso(clock + 1000) }))
    await store.put(presence({ userId: 'alan', roomId: 'studio', arrivedAt: iso(clock + 500) }))

    const room = await store.listRoom(OFFICE, 'studio')
    expect(room.map((one) => one.userId)).toEqual(['ada', 'alan', 'grace'])
  })

  it('expires a record whose heartbeat stopped, with no timer involved', async () => {
    await store.put(presence())
    clock += 89_000
    expect(await store.get(OFFICE, 'ada')).not.toBeNull()

    clock += 2_000
    // Nothing ran in between. The record is gone because somebody looked.
    expect(await store.get(OFFICE, 'ada')).toBeNull()
    expect(await store.list(OFFICE)).toEqual([])
  })

  it('keeps a record alive while the heartbeat arrives', async () => {
    await store.put(presence())
    for (let beat = 0; beat < 5; beat += 1) {
      clock += 60_000
      await store.touch(OFFICE, 'ada', 'socket-1', iso(clock))
    }
    expect(await store.get(OFFICE, 'ada')).not.toBeNull()
  })

  it('hands out copies, so a caller cannot edit the store by accident', async () => {
    await store.put(presence())
    const read = await store.get(OFFICE, 'ada')
    read!.roomId = 'somewhere-else'
    expect((await store.get(OFFICE, 'ada'))?.roomId).toBe('reception')
  })

  it('numbers events per office so a client can see a gap', async () => {
    expect(await store.currentSequence(OFFICE)).toBe(0)
    expect(await store.nextSequence(OFFICE)).toBe(1)
    expect(await store.nextSequence(OFFICE)).toBe(2)
    expect(await store.nextSequence('office-2')).toBe(1)
    expect(await store.currentSequence(OFFICE)).toBe(2)
  })
})

describe('locks in the memory store', () => {
  let store: MemoryPresenceStore

  beforeEach(() => {
    clock = Date.parse('2026-09-20T09:00:00.000Z')
    store = new MemoryPresenceStore({ ttlMs: 90_000, now })
  })

  it('tells a second locker who already holds it, rather than refusing silently', async () => {
    await store.put(presence({ userId: 'ada', roomId: 'studio' }))
    const first = await store.lock(OFFICE, {
      roomId: 'studio',
      lockedBy: 'ada',
      lockedAt: iso(clock),
    })
    const second = await store.lock(OFFICE, {
      roomId: 'studio',
      lockedBy: 'grace',
      lockedAt: iso(clock),
    })
    expect(first.lockedBy).toBe('ada')
    expect(second.lockedBy).toBe('ada')
  })

  it('unlocks a room that empties by an explicit leave', async () => {
    await store.put(presence({ userId: 'ada', roomId: 'studio' }))
    await store.lock(OFFICE, { roomId: 'studio', lockedBy: 'ada', lockedAt: iso(clock) })
    expect(await store.locks(OFFICE)).toHaveLength(1)

    await store.remove(OFFICE, 'ada')
    // Never leave a room locked with nobody in it.
    expect(await store.locks(OFFICE)).toEqual([])
  })

  it('unlocks a room that empties by a dropped connection expiring', async () => {
    await store.put(presence({ userId: 'ada', roomId: 'studio' }))
    await store.lock(OFFICE, { roomId: 'studio', lockedBy: 'ada', lockedAt: iso(clock) })

    // A crashed browser: no leave event ever arrives, the TTL is all there is.
    clock += 91_000
    expect(await store.locks(OFFICE)).toEqual([])
  })

  it('drops a knock at its expiry and keeps one knock per person per room', async () => {
    await store.put(presence({ userId: 'ada', roomId: 'studio' }))
    const knock = {
      id: 'k1',
      roomId: 'studio',
      userId: 'grace',
      displayName: 'Grace',
      createdAt: iso(clock),
      expiresAt: iso(clock + 30_000),
    }
    await store.knock(OFFICE, knock)
    await store.knock(OFFICE, { ...knock, id: 'k2', createdAt: iso(clock + 1000) })

    // Knocking again is impatience, not a second request.
    const waiting = await store.knocks(OFFICE, 'studio')
    expect(waiting).toHaveLength(1)
    expect(waiting[0]?.id).toBe('k2')

    clock += 31_000
    expect(await store.knocks(OFFICE, 'studio')).toEqual([])
  })
})
