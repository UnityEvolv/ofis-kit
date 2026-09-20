import {
  localEventBus,
  memoryRateLimiter,
  staticTemplateSource,
  typedEmailIdentity,
  unlimited,
  type Decision,
  type IdentityAdapter,
  type RateLimiter,
} from '@unityevolv/ofiskit-adapters'
import { MemoryPresenceStore } from '@unityevolv/ofiskit-presence-store'
import { createTemplate, type Template } from '@unityevolv/ofiskit-template'
import { beforeEach, describe, expect, it } from 'vitest'

import { builtInProvider, type CallHooks, type RtcServerPlugin } from './calls.js'
import { OfficeEngine } from './engine.js'
import { Refusal, type OfficeChange, type OfficeDiff } from './protocol/index.js'
import type { Transport } from './transport.js'

const OFFICE = 'office'

/** Records everything the engine sends, so a test can assert on it. */
class Recorder implements Transport {
  office: Array<{ event: string; payload: unknown }> = []
  toUsers: Array<{ userId: string; event: string; payload: unknown }> = []
  rooms: Array<{ roomId: string; event: string; payload: unknown }> = []
  connections: Array<{ connectionId: string; event: string; payload: unknown }> = []
  closed: Array<{ connectionId: string; code: string }> = []

  toOffice(_officeId: string, event: string, payload: unknown) {
    this.office.push({ event, payload })
  }
  toRoom(_officeId: string, roomId: string, event: string, payload: unknown) {
    this.rooms.push({ roomId, event, payload })
  }
  toUser(userId: string, event: string, payload: unknown) {
    this.toUsers.push({ userId, event, payload })
  }
  toConnection(connectionId: string, event: string, payload: unknown) {
    this.connections.push({ connectionId, event, payload })
  }
  close(connectionId: string, reason: { code: string }) {
    this.closed.push({ connectionId, code: reason.code })
  }

  clear() {
    this.office = []
    this.toUsers = []
    this.rooms = []
    this.connections = []
    this.closed = []
  }
}

function office(): Template {
  return createTemplate({ name: 'Test office', canvas: 'landscape', images: { light: 'o.webp' } })
}

/**
 * The diffs the office was sent, in order.
 *
 * A helper rather than an assertion each time, because after this story every
 * test that used to look for a full-state broadcast is looking at a diff, and
 * reaching into the payload in forty places is how a test file rots.
 */
function diffs(sent: Recorder): OfficeDiff[] {
  return sent.office
    .filter((one) => one.event === 'office:diff')
    .map((one) => one.payload as OfficeDiff)
}

/** Every change across every diff, flattened. */
function changes(sent: Recorder): OfficeChange[] {
  return diffs(sent).flatMap((diff) => diff.changes)
}

interface Harness {
  engine: OfficeEngine
  sent: Recorder
  store: MemoryPresenceStore
  template: Template
  events: ReturnType<typeof localEventBus>
  /** Send whatever is pending now, so a test never waits out the window. */
  flush(): Promise<void>
  enter(options: {
    name: string
    deviceId?: string
    kind?: 'web' | 'desktop' | 'mobile'
    connectionId?: string
  }): Promise<string>
}

/**
 * What a test wants different from the ordinary office.
 *
 * Named rather than positional, because this list only grows and a call site
 * reading `harness(typedEmailIdentity(), undefined, undefined, 1)` tells you
 * nothing about which knob that 1 turns.
 */
interface HarnessOptions {
  identity?: IdentityAdapter
  roomCapacity?: (room: { id: string }) => number | null
  graceMs?: number
  /**
   * Long by default, so nothing goes out until a test says so.
   *
   * A test that wants to watch the diff window close passes a short one;
   * everything else flushes by hand, which is the difference between an assertion
   * and a race.
   */
  diffWindowMs?: number
  knockTtlMs?: number
  /**
   * Unlimited by default, so a test about knocking is about knocking. The one
   * test that is about the limit passes a real limiter.
   */
  limiter?: RateLimiter
  /** Swapped by a test that is about what a provider declares, or about its hooks. */
  provider?: RtcServerPlugin
  callHooks?: CallHooks
}

function harness({
  identity = typedEmailIdentity(),
  roomCapacity,
  graceMs,
  diffWindowMs = 10_000,
  knockTtlMs,
  limiter = unlimited(),
  provider = builtInProvider(),
  callHooks,
}: HarnessOptions = {}): Harness {
  const template = office()
  const store = new MemoryPresenceStore()
  const sent = new Recorder()
  const events = localEventBus()

  const engine = new OfficeEngine({
    officeId: OFFICE,
    store,
    identity,
    templates: staticTemplateSource(template),
    transport: sent,
    events,
    limiter,
    provider,
    diffWindowMs,
    ...(callHooks ? { callHooks } : {}),
    ...(roomCapacity ? { roomCapacity } : {}),
    ...(graceMs === undefined ? {} : { graceMs }),
    ...(knockTtlMs === undefined ? {} : { knockTtlMs }),
  })

  let counter = 0

  return {
    engine,
    sent,
    store,
    template,
    events,
    async flush() {
      await engine.flush()
    },
    async enter({ name, deviceId, kind = 'web', connectionId }) {
      counter += 1
      const id = connectionId ?? `socket-${counter}`
      const device = deviceId ?? `device-${counter}`
      engine.connected({ connectionId: id, deviceId: device, kind })
      const result = await engine.enter(id, {
        credentials: { email: `${name.toLowerCase()}@example.com`, name },
        deviceId: device,
        kind,
      })
      if (!result.ok) throw new Error(`could not enter: ${result.message}`)
      return id
    },
  }
}

describe('entering the office', () => {
  let h: Harness
  beforeEach(() => {
    h = harness()
  })

  it('lands somebody in reception', async () => {
    const socket = await h.enter({ name: 'Ada' })
    const snapshot = await h.engine.snapshot(socket)
    const reception = h.template.rooms.find((room) => room.type === 'reception')

    expect(snapshot.people).toHaveLength(1)
    expect(snapshot.people[0]?.roomId).toBe(reception?.id)
    expect(snapshot.you.userId).toBe(snapshot.people[0]?.userId)
  })

  it('shows two people to each other', async () => {
    // The story's own done-when: two browsers see each other.
    const ada = await h.enter({ name: 'Ada' })
    const grace = await h.enter({ name: 'Grace' })

    for (const socket of [ada, grace]) {
      const names = (await h.engine.snapshot(socket)).people.map((one) => one.displayName).sort()
      expect(names).toEqual(['Ada', 'Grace'])
    }
  })

  it('refuses credentials the adapter does not accept', async () => {
    h.engine.connected({ connectionId: 'bad', deviceId: 'd', kind: 'web' })
    const result = await h.engine.enter('bad', {
      credentials: { email: 'not-an-email', name: 'Ada' },
      deviceId: 'd',
      kind: 'web',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('identity.email_invalid')
  })

  it('refuses when the identity adapter says no to the office', async () => {
    // The whole boundary in one test: the core does not know what a membership
    // is, and refuses anyway, because it asked.
    const closed = harness({
      identity: {
        ...typedEmailIdentity(),
        async may(): Promise<Decision> {
          return { allowed: false, code: 'office.restricted', message: 'Members only.' }
        },
      },
    })

    closed.engine.connected({ connectionId: 'c', deviceId: 'd', kind: 'web' })
    const result = await closed.engine.enter('c', {
      credentials: { email: 'ada@example.com', name: 'Ada' },
      deviceId: 'd',
      kind: 'web',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('office.restricted')
    expect(result.message).toBe('Members only.')
  })

  it('needs a device id, so a reconnect can be recognised', async () => {
    h.engine.connected({ connectionId: 'c', deviceId: 'd', kind: 'web' })
    const result = await h.engine.enter('c', {
      credentials: { email: 'ada@example.com', name: 'Ada' },
      deviceId: '',
      kind: 'web',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe(Refusal.MALFORMED)
  })
})

describe('presence is per user, not per device', () => {
  it('counts one person with two devices, not two people', async () => {
    const h = harness()
    const laptop = await h.enter({ name: 'Ada', deviceId: 'laptop' })
    await h.enter({ name: 'Ada', deviceId: 'phone', kind: 'mobile', connectionId: 'socket-phone' })

    const snapshot = await h.engine.snapshot(laptop)
    expect(snapshot.people).toHaveLength(1)
    expect(snapshot.people[0]?.devices.map((one) => one.kind).sort()).toEqual(['mobile', 'web'])
  })

  it('does not remove anybody when one of their devices disconnects', async () => {
    const h = harness()
    const laptop = await h.enter({ name: 'Ada', deviceId: 'laptop' })
    await h.enter({ name: 'Ada', deviceId: 'phone', kind: 'mobile', connectionId: 'socket-phone' })

    await h.engine.disconnected(laptop)

    // The phone is still there, so Ada is still there.
    const snapshot = await h.engine.snapshot('socket-phone')
    expect(snapshot.people).toHaveLength(1)
    expect(snapshot.people[0]?.devices).toHaveLength(1)
  })

  it('reloading replaces the device rather than accumulating one', async () => {
    const h = harness()
    await h.enter({ name: 'Ada', deviceId: 'laptop' })
    const again = await h.enter({
      name: 'Ada',
      deviceId: 'laptop',
      connectionId: 'socket-reloaded',
    })

    expect((await h.engine.snapshot(again)).people[0]?.devices).toHaveLength(1)
  })
})

describe('leaving', () => {
  it('removes somebody on a clean exit and tells the office', async () => {
    const h = harness()
    const socket = await h.enter({ name: 'Ada' })
    // The flushes are new: the office is told in diffs now, gathered over a
    // window, so a test has to say when the window closes. Without the first
    // one, the arrival and the departure cancel each other out — which is
    // correct, and has a test of its own further down.
    await h.flush()
    h.sent.clear()

    await h.engine.leaveOffice(socket)
    await h.flush()

    expect((await h.engine.snapshot(socket)).people).toHaveLength(0)
    expect(h.sent.office.some((one) => one.event === 'office:diff')).toBe(true)
  })

  it('does not remove somebody the moment their last device drops', async () => {
    // This used to remove them immediately. It no longer does, deliberately:
    // a dropped connection now starts a grace period, so a wifi blip does not
    // make somebody vanish from a room. The removal is tested below.
    const h = harness({ graceMs: 5000 })
    const socket = await h.enter({ name: 'Ada' })

    await h.engine.disconnected(socket)

    expect((await h.engine.snapshot(socket)).people).toHaveLength(1)
  })
})

describe('the credential on a live socket', () => {
  it('is updated in place, without the person flickering', async () => {
    const h = harness()
    const socket = await h.enter({ name: 'Ada' })

    const result = await h.engine.refreshAuth(socket, {
      email: 'ada@example.com',
      name: 'Ada',
    })

    expect(result.ok).toBe(true)
    // Still present, still one person, nothing disturbed.
    expect((await h.engine.snapshot(socket)).people).toHaveLength(1)
    expect(h.sent.closed).toEqual([])
  })

  it('closes the socket when the refreshed credential is refused', async () => {
    const h = harness()
    const socket = await h.enter({ name: 'Ada' })

    const result = await h.engine.refreshAuth(socket, { email: 'nonsense', name: 'Ada' })

    expect(result.ok).toBe(false)
    expect(h.sent.closed[0]?.code).toBe(Refusal.AUTH_EXPIRED)
  })

  it('will not let a different person take over the socket', async () => {
    const h = harness()
    const socket = await h.enter({ name: 'Ada' })

    const result = await h.engine.refreshAuth(socket, { email: 'grace@example.com', name: 'Grace' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe(Refusal.AUTH_REFUSED)
    expect(h.sent.closed[0]?.code).toBe(Refusal.AUTH_REFUSED)
  })
})

describe('what the host can push in', () => {
  it('disconnects somebody immediately when their access is revoked', async () => {
    const h = harness()
    const socket = await h.enter({ name: 'Ada' })
    const userId = (await h.engine.snapshot(socket)).you.userId
    h.sent.clear()

    h.events.publish({ type: 'access.revoked', userId, reason: 'Your membership ended.' })
    // The handler is async; let it run.
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Told why, then closed — never a silent drop.
    expect(h.sent.closed[0]).toEqual({ connectionId: socket, code: Refusal.ACCESS_REVOKED })
    expect((await h.engine.snapshot(socket)).people).toHaveLength(0)
  })

  it('tells the office when the layout changed', async () => {
    const h = harness()
    await h.enter({ name: 'Ada' })
    h.sent.clear()

    h.events.publish({ type: 'template.changed', officeId: OFFICE })
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(h.sent.office.some((one) => one.event === 'template:changed')).toBe(true)
  })

  it('costs nothing when the host publishes nothing', async () => {
    // The free office has no publisher at all. Subscribing still works, and
    // nothing ever arrives.
    const h = harness()
    await h.enter({ name: 'Ada' })
    h.sent.clear()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(h.sent.closed).toEqual([])
  })
})

describe('the heartbeat', () => {
  it('keeps somebody from expiring', async () => {
    const h = harness()
    const socket = await h.enter({ name: 'Ada' })

    expect((await h.engine.heartbeat(socket)).ok).toBe(true)
    expect((await h.engine.snapshot(socket)).people).toHaveLength(1)
  })

  it('is refused on a socket that has not entered', async () => {
    const h = harness()
    h.engine.connected({ connectionId: 'cold', deviceId: 'd', kind: 'web' })
    const result = await h.engine.heartbeat('cold')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe(Refusal.NOT_AUTHENTICATED)
  })
})

describe('moving between rooms', () => {
  let h: Harness
  beforeEach(() => {
    h = harness()
  })

  const roomNamed = (name: string) => h.template.rooms.find((room) => room.name === name)?.id ?? ''

  it('moves somebody and tells the office', async () => {
    const socket = await h.enter({ name: 'Ada' })
    // Flushed, because a move is now gathered into a diff rather than sent on
    // the spot. What the move is *made of* is tested in 'snapshot and diffs'.
    await h.flush()
    h.sent.clear()

    const workspace = roomNamed('Workspace')
    expect((await h.engine.joinRoom(socket, workspace)).ok).toBe(true)
    await h.flush()

    expect((await h.engine.snapshot(socket)).people[0]?.roomId).toBe(workspace)
    expect(h.sent.office.some((one) => one.event === 'office:diff')).toBe(true)
  })

  it('puts somebody back in reception when they leave a room', async () => {
    const socket = await h.enter({ name: 'Ada' })
    const reception = h.template.rooms.find((room) => room.type === 'reception')?.id

    await h.engine.joinRoom(socket, roomNamed('Workspace'))
    await h.engine.leaveRoom(socket)

    expect((await h.engine.snapshot(socket)).people[0]?.roomId).toBe(reception)
  })

  it('refuses a room that does not exist', async () => {
    const socket = await h.enter({ name: 'Ada' })
    const result = await h.engine.joinRoom(socket, 'nowhere')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe(Refusal.ROOM_UNKNOWN)
  })

  it('says so rather than pretending, when you are already there', async () => {
    const socket = await h.enter({ name: 'Ada' })
    const workspace = roomNamed('Workspace')
    await h.engine.joinRoom(socket, workspace)

    const result = await h.engine.joinRoom(socket, workspace)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe(Refusal.ROOM_ALREADY_THERE)
  })

  it('refuses a room the identity adapter says no to, with its reason', async () => {
    // The boundary again: the core does not know what a restriction is, and
    // refuses anyway, in the adapter's own words.
    const restricted = harness({
      identity: {
        ...typedEmailIdentity(),
        async may({ permission }): Promise<Decision> {
          if (permission === 'join_room') {
            return { allowed: false, code: 'room.restricted', message: 'The studio is invite only.' }
          }
          return { allowed: true }
        },
      },
    })
    const socket = await restricted.enter({ name: 'Ada' })
    const workspace = restricted.template.rooms.find((room) => room.name === 'Workspace')?.id ?? ''

    const result = await restricted.engine.joinRoom(socket, workspace)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('room.restricted')
    expect(result.message).toContain('invite only')
  })

  it('refuses a full room at the moment of the move, holding nothing', async () => {
    // Capacity is an office setting, so it arrives as a function rather than
    // as anything the template knows about.
    const limited = harness({ roomCapacity: () => 1 })
    const first = await limited.enter({ name: 'Ada' })
    const second = await limited.enter({ name: 'Grace' })
    const workspace = limited.template.rooms.find((room) => room.name === 'Workspace')?.id ?? ''

    expect((await limited.engine.joinRoom(first, workspace)).ok).toBe(true)

    // Nothing was ever reserved for the second person, so the answer is no,
    // with a reason, at the moment they actually tried.
    const refused = await limited.engine.joinRoom(second, workspace)
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.code).toBe(Refusal.ROOM_FULL)
  })

  it('tells the host, so it can remember where somebody was', async () => {
    // unityofis uses this to put a person back in their last room next time
    // they sign in. The free office has nowhere to put it and does not listen.
    const seen: Array<{ roomId: string | null }> = []
    const remembering = harness({
      identity: {
        ...typedEmailIdentity(),
        async onPresenceChanged(event) {
          seen.push({ roomId: event.roomId })
        },
      },
    })

    const socket = await remembering.enter({ name: 'Ada' })
    const workspace = remembering.template.rooms.find((room) => room.name === 'Workspace')?.id ?? ''
    await remembering.engine.joinRoom(socket, workspace)

    expect(seen).toContainEqual({ roomId: workspace })
  })
})

describe('a move is per user, not per device', () => {
  it('moves every device when one of them moves', async () => {
    const h = harness()
    const laptop = await h.enter({ name: 'Ada', deviceId: 'laptop' })
    const phone = await h.enter({
      name: 'Ada',
      deviceId: 'phone',
      kind: 'mobile',
      connectionId: 'socket-phone',
    })
    const workspace = h.template.rooms.find((room) => room.name === 'Workspace')?.id

    await h.engine.joinRoom(laptop, workspace ?? '')

    // The phone did not have to be told. There is only one answer to where
    // Ada is, and both devices are looking at it.
    const fromPhone = await h.engine.snapshot(phone)
    expect(fromPhone.people).toHaveLength(1)
    expect(fromPhone.people[0]?.roomId).toBe(workspace)
    expect(fromPhone.people[0]?.devices).toHaveLength(2)
  })

  it('leaves everybody where they are when one device disconnects', async () => {
    const h = harness()
    const laptop = await h.enter({ name: 'Ada', deviceId: 'laptop' })
    await h.enter({ name: 'Ada', deviceId: 'phone', kind: 'mobile', connectionId: 'socket-phone' })
    const workspace = h.template.rooms.find((room) => room.name === 'Workspace')?.id ?? ''

    await h.engine.joinRoom(laptop, workspace)
    await h.engine.disconnected(laptop)

    const snapshot = await h.engine.snapshot('socket-phone')
    expect(snapshot.people[0]?.roomId).toBe(workspace)
  })
})

describe('disconnecting, waiting, and coming back', () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  it('keeps somebody in their room during the grace period', async () => {
    const h = harness({ graceMs: 300 })
    const socket = await h.enter({ name: 'Ada' })
    const workspace = h.template.rooms.find((room) => room.name === 'Workspace')?.id ?? ''
    await h.engine.joinRoom(socket, workspace)

    await h.engine.disconnected(socket)

    // A laptop closing for ten seconds changes nothing visible, except that
    // everyone can see they are coming back.
    const snapshot = await h.engine.snapshot(socket)
    expect(snapshot.people).toHaveLength(1)
    expect(snapshot.people[0]?.roomId).toBe(workspace)
    expect(snapshot.people[0]?.status).toBe('reconnecting')
  })

  it('removes them once the grace period passes with nobody back', async () => {
    const h = harness({ graceMs: 60 })
    const socket = await h.enter({ name: 'Ada' })

    await h.engine.disconnected(socket)
    await sleep(160)

    expect((await h.engine.snapshot(socket)).people).toHaveLength(0)
  })

  it('puts them back where they were when they return in time', async () => {
    const h = harness({ graceMs: 400 })
    const socket = await h.enter({ name: 'Ada', deviceId: 'laptop' })
    const workspace = h.template.rooms.find((room) => room.name === 'Workspace')?.id ?? ''
    await h.engine.joinRoom(socket, workspace)

    await h.engine.disconnected(socket)
    const again = await h.enter({
      name: 'Ada',
      deviceId: 'laptop',
      connectionId: 'socket-again',
    })

    const back = await h.engine.snapshot(again)
    expect(back.people).toHaveLength(1)
    expect(back.people[0]?.roomId).toBe(workspace)
    expect(back.people[0]?.status).not.toBe('reconnecting')

    // And the timer really was cancelled, rather than firing later and
    // removing somebody who is sitting right there.
    await sleep(500)
    expect((await h.engine.snapshot(again)).people).toHaveLength(1)
  })

  it('skips the grace period entirely on a clean exit', async () => {
    const h = harness({ graceMs: 5000 })
    const socket = await h.enter({ name: 'Ada' })

    await h.engine.leaveOffice(socket)

    // They said they were going. Making everyone watch them linger for thirty
    // seconds would just be wrong.
    expect((await h.engine.snapshot(socket)).people).toHaveLength(0)
  })

  it('starts no grace period while another device is still open', async () => {
    const h = harness({ graceMs: 60 })
    const laptop = await h.enter({ name: 'Ada', deviceId: 'laptop' })
    await h.enter({ name: 'Ada', deviceId: 'phone', kind: 'mobile', connectionId: 'socket-phone' })

    await h.engine.disconnected(laptop)
    await sleep(160)

    // The phone is still there, so there was never anything to wait for.
    const snapshot = await h.engine.snapshot('socket-phone')
    expect(snapshot.people).toHaveLength(1)
    expect(snapshot.people[0]?.status).not.toBe('reconnecting')
  })
})

describe('status', () => {
  let h: Harness
  beforeEach(() => {
    h = harness()
  })

  const roomOfType = (type: string) => h.template.rooms.find((room) => room.type === type)?.id ?? ''
  const statusOf = async (socket: string) => (await h.engine.snapshot(socket)).people[0]?.status

  it('is available with one active device', async () => {
    const socket = await h.enter({ name: 'Ada' })
    expect(await statusOf(socket)).toBe('available')
  })

  it('sets do not disturb on entering the break room, and clears it on leaving', async () => {
    const socket = await h.enter({ name: 'Ada' })

    await h.engine.joinRoom(socket, roomOfType('break'))
    expect(await statusOf(socket)).toBe('dnd')

    await h.engine.joinRoom(socket, roomOfType('workspace'))
    expect(await statusOf(socket)).toBe('available')
  })

  it('goes away when every device is idle, and comes back on any input', async () => {
    const socket = await h.enter({ name: 'Ada' })

    await h.engine.setActivity(socket, { idle: true, foreground: true })
    expect(await statusOf(socket)).toBe('away')

    await h.engine.setActivity(socket, { idle: false, foreground: true })
    expect(await statusOf(socket)).toBe('available')
  })

  it('keeps somebody available on their laptop while their phone is backgrounded', async () => {
    const laptop = await h.enter({ name: 'Ada', deviceId: 'laptop' })
    const phone = await h.enter({
      name: 'Ada',
      deviceId: 'phone',
      kind: 'mobile',
      connectionId: 'socket-phone',
    })

    // Resolves to the most active device: idle on one is not away.
    await h.engine.setActivity(phone, { idle: false, foreground: false })
    expect(await statusOf(laptop)).toBe('available')

    await h.engine.setActivity(laptop, { idle: true, foreground: true })
    expect(await statusOf(laptop)).toBe('away')
  })

  it('lets a chosen status survive the break room and going idle', async () => {
    const socket = await h.enter({ name: 'Ada' })
    expect((await h.engine.setManualStatus(socket, 'available')).ok).toBe(true)

    await h.engine.joinRoom(socket, roomOfType('break'))
    await h.engine.setActivity(socket, { idle: true, foreground: true })

    // They chose it. Nothing automatic gets to overrule that.
    expect(await statusOf(socket)).toBe('available')
  })

  it('clears what the break room set, but only what the break room set', async () => {
    const socket = await h.enter({ name: 'Ada' })

    // Room-imposed: cleared on the way out.
    await h.engine.joinRoom(socket, roomOfType('break'))
    await h.engine.joinRoom(socket, roomOfType('workspace'))
    expect(await statusOf(socket)).toBe('available')

    // Chosen: survives the same round trip.
    await h.engine.setManualStatus(socket, 'dnd')
    await h.engine.joinRoom(socket, roomOfType('break'))
    await h.engine.joinRoom(socket, roomOfType('workspace'))
    expect(await statusOf(socket)).toBe('dnd')
  })

  it('shows reconnecting during the grace period', async () => {
    const graced = harness({ graceMs: 300 })
    const socket = await graced.enter({ name: 'Ada' })

    await graced.engine.disconnected(socket)

    expect((await graced.engine.snapshot(socket)).people[0]?.status).toBe('reconnecting')
  })

  it('carries a custom status, and drops it at its expiry with nothing running', async () => {
    const socket = await h.enter({ name: 'Ada' })

    await h.engine.setCustomStatus(socket, {
      text: 'Lunch',
      emoji: '🥪',
      expiresAt: new Date(Date.now() + 40).toISOString(),
    })
    expect((await h.engine.snapshot(socket)).people[0]?.custom?.text).toBe('Lunch')

    await new Promise((resolve) => setTimeout(resolve, 60))

    // Nothing swept it. It is gone because somebody read it.
    expect((await h.engine.snapshot(socket)).people[0]?.custom).toBeUndefined()
  })

  it('refuses a custom status with no words, and one that is far too long', async () => {
    const socket = await h.enter({ name: 'Ada' })

    expect((await h.engine.setCustomStatus(socket, { text: '   ' })).ok).toBe(false)
    expect((await h.engine.setCustomStatus(socket, { text: 'x'.repeat(200) })).ok).toBe(false)
  })

  it('refuses a status that is not one of the three', async () => {
    const socket = await h.enter({ name: 'Ada' })
    const result = await h.engine.setManualStatus(socket, 'asleep' as never)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe(Refusal.MALFORMED)
  })
})

describe('snapshot and diffs', () => {
  let h: Harness
  beforeEach(() => {
    h = harness()
  })

  const roomOfType = (type: string) => h.template.rooms.find((room) => room.type === type)?.id ?? ''
  const named = (name: string) => h.template.rooms.find((room) => room.name === name)?.id ?? ''

  it('stamps the snapshot with the last number it accounts for', async () => {
    const socket = await h.enter({ name: 'Ada' })

    // Nothing has gone out yet, so the snapshot is stamped 0 — and it contains
    // Ada anyway, because the store has her. The diff that follows restates her
    // and the client applies it to no effect. That is cheaper than flushing the
    // whole office every time somebody walks in.
    const before = await h.engine.snapshot(socket)
    expect(before.seq).toBe(0)
    expect(before.people).toHaveLength(1)

    await h.flush()
    expect(diffs(h.sent)[0]?.seq).toBe(1)
    expect((await h.engine.snapshot(socket)).seq).toBe(1)
  })

  it('numbers diffs strictly increasing, one at a time', async () => {
    const socket = await h.enter({ name: 'Ada' })
    await h.flush()
    await h.engine.joinRoom(socket, named('Workspace'))
    await h.flush()
    await h.engine.setManualStatus(socket, 'dnd')
    await h.flush()

    // A client seeing 1 then 3 knows it missed one. That is the only thing the
    // number has to do, and it is why it is allocated by the store rather than
    // counted per process.
    expect(diffs(h.sent).map((diff) => diff.seq)).toEqual([1, 2, 3])
  })

  it('sends a move as a move, not as the whole office', async () => {
    const socket = await h.enter({ name: 'Ada' })
    await h.flush()
    h.sent.clear()

    const workspace = named('Workspace')
    await h.engine.joinRoom(socket, workspace)
    await h.flush()

    expect(changes(h.sent)).toEqual([
      {
        kind: 'person.moved',
        userId: expect.any(String),
        roomId: workspace,
        arrivedAt: expect.any(String),
      },
    ])
    // The point of the story: a move does not carry a person, let alone an office.
    expect(JSON.stringify(diffs(h.sent))).not.toContain('displayName')
  })

  it('coalesces a drag through three rooms into one event at the last room', async () => {
    const socket = await h.enter({ name: 'Ada' })
    await h.flush()
    h.sent.clear()

    await h.engine.joinRoom(socket, named('Workspace'))
    await h.engine.joinRoom(socket, roomOfType('break'))
    await h.engine.joinRoom(socket, roomOfType('reception'))
    await h.flush()

    // One event, and it says where they ended up. The office has no use for the
    // two rooms they passed through and could not have rendered them anyway.
    const only = changes(h.sent)
    expect(only).toHaveLength(1)
    expect(only[0]?.kind === 'person.updated' ? only[0].presence.roomId : '').toBe(
      roomOfType('reception'),
    )
  })

  it('tells a hundred people about one move exactly once', async () => {
    // The done-when, stated as a test. Everyone present receives everything —
    // visibility is uniform — so what has to be small is the event, not the
    // audience.
    for (let i = 0; i < 100; i += 1) await h.enter({ name: `Person${i}` })
    const mover = await h.enter({ name: 'Ada' })
    await h.flush()
    h.sent.clear()

    await h.engine.joinRoom(mover, named('Workspace'))
    await h.flush()

    expect(h.sent.office).toHaveLength(1)
    expect(changes(h.sent)).toHaveLength(1)
  })

  it('re-sends the entry when somebody changes before their arrival has gone out', async () => {
    const socket = await h.enter({ name: 'Ada' })
    await h.engine.setManualStatus(socket, 'dnd')
    await h.flush()

    // Not an update: a client that has not heard of this person yet has nothing
    // to apply an update to.
    const only = changes(h.sent)
    expect(only).toHaveLength(1)
    expect(only[0]?.kind).toBe('person.entered')
    expect(only[0]?.kind === 'person.entered' ? only[0].presence.status : '').toBe('dnd')
  })

  it('says nothing at all about somebody who arrived and left inside one window', async () => {
    const socket = await h.enter({ name: 'Ada' })
    await h.engine.leaveOffice(socket)
    await h.flush()

    // Telling the office that a stranger has left is noise, and it would consume
    // a sequence number that every client then has to account for.
    expect(h.sent.office).toHaveLength(0)
  })

  it('reports a departure once the office has heard of the person', async () => {
    const socket = await h.enter({ name: 'Ada' })
    await h.flush()
    h.sent.clear()

    await h.engine.leaveOffice(socket)
    await h.flush()

    expect(changes(h.sent)).toEqual([{ kind: 'person.left', userId: expect.any(String) }])
  })

  it('sends the person, not just the move, when the break room changes their status', async () => {
    const socket = await h.enter({ name: 'Ada' })
    await h.flush()
    h.sent.clear()

    await h.engine.joinRoom(socket, roomOfType('break'))
    await h.flush()

    // A bare `person.moved` carries no status, and the break room changed one.
    const only = changes(h.sent)
    expect(only[0]?.kind).toBe('person.updated')
    expect(only[0]?.kind === 'person.updated' ? only[0].presence.status : '').toBe('dnd')
  })

  it('says nothing when a device goes idle without changing the answer', async () => {
    const laptop = await h.enter({ name: 'Ada', deviceId: 'laptop' })
    await h.enter({ name: 'Ada', deviceId: 'phone', kind: 'mobile' })
    await h.flush()
    h.sent.clear()

    await h.engine.setActivity(laptop, { idle: true, foreground: true })
    await h.flush()

    // Still available, because the phone is active. Idle flags arrive constantly,
    // and this is what stops almost all of them costing an event.
    expect(h.sent.office).toHaveLength(0)
  })

  it('closes the window on its own, without anybody flushing', async () => {
    const quick = harness({ diffWindowMs: 1 })
    await quick.enter({ name: 'Ada' })
    await quick.flush()
    quick.sent.clear()

    await quick.enter({ name: 'Grace' })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(diffs(quick.sent)).toHaveLength(1)
    expect(changes(quick.sent)[0]?.kind).toBe('person.entered')
    await quick.engine.close()
  })

  it('gives a client that lost track the whole office again, at a number it can trust', async () => {
    const watcher = await h.enter({ name: 'Ada' })
    const other = await h.enter({ name: 'Grace' })
    await h.engine.joinRoom(other, named('Workspace'))
    await h.flush()
    h.sent.clear()

    const result = await h.engine.resync(watcher)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.snapshot.people).toHaveLength(2)
    expect(result.snapshot.seq).toBe(1)
    expect(result.snapshot.you.userId).toBe(
      result.snapshot.people.find((person) => person.displayName === 'Ada')?.userId,
    )
    // A resync is a read. It does not tell the office anything.
    expect(h.sent.office).toHaveLength(0)
  })

  it('refuses a resync from a socket that is not in the office', async () => {
    h.engine.connected({ connectionId: 'stranger', deviceId: 'd', kind: 'web' })
    const result = await h.engine.resync('stranger')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe(Refusal.NOT_AUTHENTICATED)
  })

  it('gets everything out before the server goes', async () => {
    const socket = await h.enter({ name: 'Ada' })
    await h.engine.joinRoom(socket, named('Workspace'))
    expect(h.sent.office).toHaveLength(0)

    await h.engine.close()

    // A diff lost to shutdown leaves every connected client one event behind,
    // and they would only find out on the next change.
    expect(diffs(h.sent)).toHaveLength(1)
  })
})

describe('lock, knock and admit', () => {
  let h: Harness
  beforeEach(() => {
    h = harness()
  })

  const named = (name: string) => h.template.rooms.find((room) => room.name === name)?.id ?? ''
  const typed = (type: string) => h.template.rooms.find((room) => room.type === type)?.id ?? ''

  /** What one person was sent, by event name. */
  const sentTo = (userId: string, event: string) =>
    h.sent.toUsers.filter((one) => one.userId === userId && one.event === event)

  const userIdOf = async (socket: string) => (await h.engine.snapshot(socket)).you.userId

  /** Two people in the workspace, with it locked behind them. */
  async function twoInsideLocked() {
    const workspace = named('Workspace')
    const ada = await h.enter({ name: 'Ada' })
    const grace = await h.enter({ name: 'Grace' })
    await h.engine.joinRoom(ada, workspace)
    await h.engine.joinRoom(grace, workspace)
    expect((await h.engine.lock(ada, workspace)).ok).toBe(true)
    await h.flush()
    h.sent.clear()
    return { ada, grace, workspace }
  }

  it('lets anyone inside lock the room, and shows it to the whole office', async () => {
    const { ada, workspace } = await twoInsideLocked()

    // Visible from the office rather than only from inside, so nobody is
    // surprised by a door that will not open.
    const snapshot = await h.engine.snapshot(ada)
    expect(snapshot.locks).toEqual([{ roomId: workspace, lockedBy: await userIdOf(ada) }])
  })

  it('refuses to lock a room you are not in', async () => {
    const outside = await h.enter({ name: 'Ada' })
    const result = await h.engine.lock(outside, named('Workspace'))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe(Refusal.ROOM_NOT_INSIDE)
  })

  it('refuses to lock reception or the break room', async () => {
    // Open by design. A lockable reception is a way to lock everybody out of the
    // office.
    const socket = await h.enter({ name: 'Ada' })
    const result = await h.engine.lock(socket, typed('reception'))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe(Refusal.ROOM_NOT_LOCKABLE)
  })

  it('refuses to lock when the identity adapter says no', async () => {
    // Guests cannot lock. The core does not know what a guest is and refuses
    // anyway, because it asked.
    const guests = harness({
      identity: {
        ...typedEmailIdentity(),
        async may({ permission }): Promise<Decision> {
          if (permission === 'lock_room') {
            return { allowed: false, code: 'room.guest', message: 'Guests cannot lock a room.' }
          }
          return { allowed: true }
        },
      },
    })

    const socket = await guests.enter({ name: 'Ada' })
    const workspace = guests.template.rooms.find((room) => room.name === 'Workspace')?.id ?? ''
    await guests.engine.joinRoom(socket, workspace)
    const result = await guests.engine.lock(socket, workspace)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toBe('Guests cannot lock a room.')
  })

  it('keeps somebody out of a locked room and tells them to knock', async () => {
    const { workspace } = await twoInsideLocked()
    const outsider = await h.enter({ name: 'Alan' })

    const result = await h.engine.joinRoom(outsider, workspace)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe(Refusal.ROOM_LOCKED)
  })

  it('tells everyone inside about a knock, and the knocker who heard it', async () => {
    const { ada, grace, workspace } = await twoInsideLocked()
    const outsider = await h.enter({ name: 'Alan' })
    await h.flush()

    const knocked = await h.engine.knock(outsider, workspace)
    expect(knocked.ok).toBe(true)
    if (!knocked.ok) return

    expect(sentTo(await userIdOf(ada), 'knock:received')).toHaveLength(1)
    expect(sentTo(await userIdOf(grace), 'knock:received')).toHaveLength(1)
    // Somebody was there to hear it.
    expect(knocked.silent).toBe(false)
  })

  it('arrives without a sound for somebody on do not disturb', async () => {
    const { ada, workspace } = await twoInsideLocked()
    await h.engine.setManualStatus(ada, 'dnd')
    const outsider = await h.enter({ name: 'Alan' })
    h.sent.clear()

    const knocked = await h.engine.knock(outsider, workspace)
    expect(knocked.ok).toBe(true)
    if (!knocked.ok) return

    // Not refused. Do not disturb suppresses interruption, not access — so the
    // knock still arrives, it just arrives silently, and the knocker is told why
    // it may go unanswered.
    const received = sentTo(await userIdOf(ada), 'knock:received')[0]?.payload as { silent: boolean }
    expect(received.silent).toBe(true)
    // Grace is not on do not disturb, so it is not silent for the room.
    expect(knocked.silent).toBe(false)
  })

  it('says silent when everybody inside is on do not disturb', async () => {
    const { ada, grace, workspace } = await twoInsideLocked()
    await h.engine.setManualStatus(ada, 'dnd')
    await h.engine.setManualStatus(grace, 'dnd')
    const outsider = await h.enter({ name: 'Alan' })

    const knocked = await h.engine.knock(outsider, workspace)
    expect(knocked.ok).toBe(true)
    if (!knocked.ok) return
    expect(knocked.silent).toBe(true)
  })

  it('refuses a knock on a room that is not locked, and on one you are in', async () => {
    const workspace = named('Workspace')
    const inside = await h.enter({ name: 'Ada' })
    const outside = await h.enter({ name: 'Grace' })
    await h.engine.joinRoom(inside, workspace)

    const open = await h.engine.knock(outside, workspace)
    expect(open.ok).toBe(false)
    if (!open.ok) expect(open.code).toBe(Refusal.KNOCK_NOT_LOCKED)

    await h.engine.lock(inside, workspace)
    const ownRoom = await h.engine.knock(inside, workspace)
    expect(ownRoom.ok).toBe(false)
    if (!ownRoom.ok) expect(ownRoom.code).toBe(Refusal.KNOCK_INSIDE)
  })

  it('rate limits somebody knocking over and over', async () => {
    const limited = harness({ limiter: memoryRateLimiter() })
    const workspace = limited.template.rooms.find((room) => room.name === 'Workspace')?.id ?? ''
    const inside = await limited.enter({ name: 'Ada' })
    await limited.engine.joinRoom(inside, workspace)
    await limited.engine.lock(inside, workspace)
    const outsider = await limited.enter({ name: 'Alan' })

    const outcomes: boolean[] = []
    for (let i = 0; i < 7; i += 1) {
      outcomes.push((await limited.engine.knock(outsider, workspace)).ok)
    }

    // Five, then no. Not a security limit — a knock interrupts everyone in the
    // room, so twelve of them is a way to make the room unusable.
    expect(outcomes).toEqual([true, true, true, true, true, false, false])
    const last = await limited.engine.knock(outsider, workspace)
    if (!last.ok) expect(last.code).toBe(Refusal.KNOCK_RATE_LIMITED)
  })

  it('replaces an earlier knock from the same person rather than stacking them', async () => {
    const { workspace } = await twoInsideLocked()
    const outsider = await h.enter({ name: 'Alan' })

    await h.engine.knock(outsider, workspace)
    await h.engine.knock(outsider, workspace)

    // Knocking again is impatience, not a second request, and two rows would be
    // two cards on the screen of everybody inside.
    expect(await h.store.knocks(OFFICE, workspace)).toHaveLength(1)
  })

  it('lets exactly one person in while the room stays locked', async () => {
    const { ada, workspace } = await twoInsideLocked()
    const alan = await h.enter({ name: 'Alan' })
    const other = await h.enter({ name: 'Bob' })

    const knocked = await h.engine.knock(alan, workspace)
    expect(knocked.ok).toBe(true)
    if (!knocked.ok) return

    expect((await h.engine.admit(ada, knocked.knockId)).ok).toBe(true)
    expect((await h.engine.joinRoom(alan, workspace)).ok).toBe(true)

    // The whole point of admitting rather than unlocking: the door is still shut
    // behind them.
    const stillOut = await h.engine.joinRoom(other, workspace)
    expect(stillOut.ok).toBe(false)
    if (!stillOut.ok) expect(stillOut.code).toBe(Refusal.ROOM_LOCKED)
    expect((await h.engine.snapshot(ada)).locks).toHaveLength(1)
  })

  it('spends the admission on the move it authorises', async () => {
    const { ada, workspace } = await twoInsideLocked()
    const alan = await h.enter({ name: 'Alan' })

    const knocked = await h.engine.knock(alan, workspace)
    if (!knocked.ok) return
    await h.engine.admit(ada, knocked.knockId)
    await h.engine.joinRoom(alan, workspace)
    await h.engine.leaveRoom(alan)

    // An admission is permission to come in now, not a key to the room.
    const again = await h.engine.joinRoom(alan, workspace)
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.code).toBe(Refusal.ROOM_LOCKED)
  })

  it('refuses an admitted person if the room filled before they moved', async () => {
    // Admission is an invitation to move, not a reservation. Nothing is held.
    const small = harness({ roomCapacity: () => 2 })
    const workspace = small.template.rooms.find((room) => room.name === 'Workspace')?.id ?? ''
    const ada = await small.enter({ name: 'Ada' })
    await small.engine.joinRoom(ada, workspace)
    await small.engine.lock(ada, workspace)

    // Two people are let in, and there is one place. Nothing is held for either
    // of them, so whoever walks in first gets it.
    const alan = await small.enter({ name: 'Alan' })
    const bob = await small.enter({ name: 'Bob' })
    const alanKnock = await small.engine.knock(alan, workspace)
    const bobKnock = await small.engine.knock(bob, workspace)
    if (!alanKnock.ok || !bobKnock.ok) return
    expect((await small.engine.admit(ada, alanKnock.knockId)).ok).toBe(true)
    expect((await small.engine.admit(ada, bobKnock.knockId)).ok).toBe(true)

    expect((await small.engine.joinRoom(bob, workspace)).ok).toBe(true)

    const result = await small.engine.joinRoom(alan, workspace)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe(Refusal.ROOM_FULL)

    // And Alan is exactly where he was, told why.
    const reception = small.template.rooms.find((room) => room.type === 'reception')?.id
    const snapshot = await small.engine.snapshot(alan)
    expect(snapshot.people.find((one) => one.displayName === 'Alan')?.roomId).toBe(reception)
  })

  it('tells the knocker and the room when a knock is declined', async () => {
    const { ada, workspace } = await twoInsideLocked()
    const alan = await h.enter({ name: 'Alan' })
    const alanId = await userIdOf(alan)
    const knocked = await h.engine.knock(alan, workspace)
    if (!knocked.ok) return
    h.sent.clear()

    expect((await h.engine.decline(ada, knocked.knockId)).ok).toBe(true)

    expect(sentTo(alanId, 'knock:resolved')).toHaveLength(1)
    // The room too, so the card disappears from every screen rather than only
    // from the screen of whoever pressed the button.
    expect(h.sent.rooms.some((one) => one.event === 'knock:resolved')).toBe(true)
    expect(await h.store.knocks(OFFICE, workspace)).toHaveLength(0)
  })

  it('refuses to answer a knock on somebody else’s door', async () => {
    const { workspace } = await twoInsideLocked()
    const alan = await h.enter({ name: 'Alan' })
    const knocked = await h.engine.knock(alan, workspace)
    if (!knocked.ok) return

    // Alan is outside, so this knock is not on a door he is behind.
    const result = await h.engine.admit(alan, knocked.knockId)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe(Refusal.KNOCK_UNKNOWN)
  })

  it('gives up on a knock nobody answered', async () => {
    const quick = harness({ knockTtlMs: 30 })
    const workspace = quick.template.rooms.find((room) => room.name === 'Workspace')?.id ?? ''
    const ada = await quick.enter({ name: 'Ada' })
    await quick.engine.joinRoom(ada, workspace)
    await quick.engine.lock(ada, workspace)
    const alan = await quick.enter({ name: 'Alan' })
    const alanId = (await quick.engine.snapshot(alan)).you.userId

    const knocked = await quick.engine.knock(alan, workspace)
    if (!knocked.ok) return
    await new Promise((resolve) => setTimeout(resolve, 60))

    // Ignoring a knock is a complete answer, so it needs no button — it stops
    // sitting on the screen on its own.
    const resolvedEvents = quick.sent.toUsers.filter(
      (one) => one.userId === alanId && one.event === 'knock:resolved',
    )
    expect(resolvedEvents).toHaveLength(1)
    expect((resolvedEvents[0]?.payload as { outcome: string }).outcome).toBe('expired')
    await quick.engine.close()
  })

  it('unlocks a room the last person walks out of', async () => {
    const workspace = named('Workspace')
    const ada = await h.enter({ name: 'Ada' })
    await h.engine.joinRoom(ada, workspace)
    await h.engine.lock(ada, workspace)
    await h.flush()
    h.sent.clear()

    await h.engine.leaveRoom(ada)
    await h.flush()

    expect(changes(h.sent)).toContainEqual({ kind: 'room.unlocked', roomId: workspace })
    expect((await h.engine.snapshot(ada)).locks).toHaveLength(0)
  })

  it('unlocks a room that empties by a connection dropping and never coming back', async () => {
    // The done-when: a crashed browser must not leave a room locked with nobody
    // in it and no way back in.
    const graced = harness({ graceMs: 40 })
    const workspace = graced.template.rooms.find((room) => room.name === 'Workspace')?.id ?? ''
    const ada = await graced.enter({ name: 'Ada' })
    await graced.engine.joinRoom(ada, workspace)
    await graced.engine.lock(ada, workspace)
    await graced.flush()
    graced.sent.clear()

    await graced.engine.disconnected(ada)
    await new Promise((resolve) => setTimeout(resolve, 90))
    await graced.flush()

    const sent = graced.sent.office
      .filter((one) => one.event === 'office:diff')
      .flatMap((one) => (one.payload as OfficeDiff).changes)
    expect(sent).toContainEqual({ kind: 'room.unlocked', roomId: workspace })
    await graced.engine.close()
  })

  it('says nothing about a lock when an ordinary departure changes nothing', async () => {
    // Without the check, every departure from every room announces an unlock,
    // and a client cannot tell that from a door that really did just open.
    const ada = await h.enter({ name: 'Ada' })
    await h.engine.joinRoom(ada, named('Workspace'))
    await h.flush()
    h.sent.clear()

    await h.engine.leaveRoom(ada)
    await h.flush()

    expect(changes(h.sent).some((change) => change.kind === 'room.unlocked')).toBe(false)
  })

  it('lets anyone inside unlock, not only whoever locked it', async () => {
    const { grace, workspace } = await twoInsideLocked()

    expect((await h.engine.unlock(grace, workspace)).ok).toBe(true)
    await h.flush()

    expect(changes(h.sent)).toContainEqual({ kind: 'room.unlocked', roomId: workspace })
    const outsider = await h.enter({ name: 'Alan' })
    expect((await h.engine.joinRoom(outsider, workspace)).ok).toBe(true)
  })
})

describe('the provider interface', () => {
  it('declares what the built-in provider can and cannot do', () => {
    // Declared rather than assumed, because the UI disables what is unavailable
    // and has to be able to say why.
    const provider = builtInProvider()

    expect(provider.name).toBe('builtin')
    expect(provider.limits).toEqual({
      // Four, because a full mesh has everybody sending their camera separately
      // to everybody else. Five people is twenty streams.
      maxParticipants: 4,
      video: true,
      screenShare: true,
      // There is no server to record on, which is exactly why it is the free tier.
      serverRecording: false,
    })
  })

  it('declares a cost model, and no origins of its own', () => {
    const provider = builtInProvider()

    // Nothing here bills anyone. It is declared so a provider cannot be added
    // without somebody having thought about what it costs.
    expect(provider.cost.model).toBe('egress')
    // It reaches only our own socket, so a host's content security policy needs
    // nothing extra for it.
    expect(provider.origins).toEqual([])
  })

  it('issues credentials the core never reads, and relay servers the host supplies', async () => {
    const withRelay = builtInProvider({
      iceServersFor: () => [{ urls: 'turn:relay.example', username: 'u', credential: 'c' }],
    })

    const credentials = await withRelay.credentialsFor({
      officeId: OFFICE,
      roomId: 'studio',
      callId: 'c1',
      userId: 'ada',
      deviceId: 'laptop',
      displayName: 'Ada',
    })

    // The mesh needs no token: the peers are each other. What it needs is a way
    // through a corporate firewall.
    expect(credentials.credentials).toEqual({ transport: 'mesh' })
    expect(credentials.iceServers).toHaveLength(1)
  })

  it('is swappable: the engine takes the cap from whatever plugin it was given', async () => {
    // The property the interface exists to have. A second provider means writing
    // these methods and touching no call, presence or UI code.
    const pair: RtcServerPlugin = {
      ...builtInProvider(),
      name: 'pair',
      limits: { maxParticipants: 2, video: false, screenShare: false, serverRecording: false },
    }
    const h = harness({ provider: pair })
    const workspace = h.template.rooms.find((room) => room.name === 'Workspace')?.id ?? ''

    const ada = await h.enter({ name: 'Ada' })
    await h.engine.joinRoom(ada, workspace)

    // Video is refused because this provider says it cannot do video, and the
    // engine never asked what kind of provider it was.
    const video = await h.engine.joinCall(ada, { audio: true, video: true })
    expect(video.ok).toBe(false)
    if (!video.ok) expect(video.code).toBe(Refusal.CALL_UNSUPPORTED)

    const audio = await h.engine.joinCall(ada, { audio: true, video: false })
    expect(audio.ok).toBe(true)
    if (audio.ok) expect(audio.call.call.limit).toBe(2)
  })
})

describe('joining and leaving a call', () => {
  let h: Harness
  beforeEach(() => {
    h = harness()
  })

  const named = (name: string) => h.template.rooms.find((room) => room.name === name)?.id ?? ''
  const typed = (type: string) => h.template.rooms.find((room) => room.type === type)?.id ?? ''

  /** Somebody in a room that can hold a call. */
  async function inWorkspace(name: string) {
    const socket = await h.enter({ name })
    await h.engine.joinRoom(socket, named('Workspace'))
    return socket
  }

  it('does not join the call just because somebody entered the room', async () => {
    const socket = await inWorkspace('Ada')
    await h.flush()

    // Presence and the call are separate things. Being in the room is not being
    // in the conversation happening in it.
    expect((await h.engine.snapshot(socket)).calls).toHaveLength(0)
    expect((await h.engine.snapshot(socket)).people[0]?.status).toBe('available')
  })

  it('starts the call on the first person turning on audio', async () => {
    const socket = await inWorkspace('Ada')
    const result = await h.engine.joinCall(socket, { audio: true, video: false })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.call.call).toMatchObject({ roomId: named('Workspace'), provider: 'builtin' })
    expect(result.call.call.participants).toHaveLength(1)
    // Nobody else is here yet, so there is nobody to connect to.
    expect(result.call.participants).toHaveLength(0)
  })

  it('shows the call to the whole office, from outside the room', async () => {
    const socket = await inWorkspace('Ada')
    await h.flush()
    h.sent.clear()

    await h.engine.joinCall(socket, { audio: true, video: false })
    await h.flush()

    // Visible from outside, so nobody walks in on a conversation they did not
    // know was happening.
    const call = changes(h.sent).find((change) => change.kind === 'call.updated')
    expect(call).toBeDefined()
    expect((await h.engine.snapshot(socket)).calls).toHaveLength(1)
  })

  it('sets the status to in a call, and clears it on the way out', async () => {
    const socket = await inWorkspace('Ada')

    await h.engine.joinCall(socket, { audio: true, video: false })
    expect((await h.engine.snapshot(socket)).people[0]?.status).toBe('in_call')

    await h.engine.leaveCall(socket)
    expect((await h.engine.snapshot(socket)).people[0]?.status).toBe('available')
  })

  it('outranks away, because somebody listening is not idle', async () => {
    const socket = await inWorkspace('Ada')
    await h.engine.joinCall(socket, { audio: true, video: false })

    // Twenty minutes of not touching the keyboard, in a call. Every call product
    // accepts that a muted person who walked away still reads as in a call.
    await h.engine.setActivity(socket, { idle: true, foreground: true })

    expect((await h.engine.snapshot(socket)).people[0]?.status).toBe('in_call')
  })

  it('tells the office which devices are in the call and what they are doing', async () => {
    const socket = await inWorkspace('Ada')
    await h.engine.joinCall(socket, { audio: true, video: true })

    const device = (await h.engine.snapshot(socket)).people[0]?.devices[0]
    expect(device).toMatchObject({ inCall: true, muted: false, cameraOn: true, sharing: false })

    await h.engine.setMediaState(socket, { muted: true, cameraOn: false, sharing: true })
    const after = (await h.engine.snapshot(socket)).people[0]?.devices[0]
    expect(after).toMatchObject({ muted: true, cameraOn: false, sharing: true })
  })

  it('ends the call when the last person leaves it, and not before', async () => {
    const ada = await inWorkspace('Ada')
    const grace = await inWorkspace('Grace')
    await h.engine.joinCall(ada, { audio: true, video: false })
    await h.engine.joinCall(grace, { audio: true, video: false })

    await h.engine.leaveCall(ada)
    // Still a call: one person sitting quietly in it is still a call.
    expect((await h.engine.snapshot(grace)).calls).toHaveLength(1)

    await h.engine.leaveCall(grace)
    expect((await h.engine.snapshot(grace)).calls).toHaveLength(0)
  })

  it('never has a call in reception or the break room', async () => {
    const socket = await h.enter({ name: 'Ada' })

    // One is a thoroughfare and the other is where people go to not be in a
    // conversation.
    const reception = await h.engine.joinCall(socket, { audio: true, video: false })
    expect(reception.ok).toBe(false)
    if (!reception.ok) expect(reception.code).toBe(Refusal.ROOM_NO_CALLS)

    await h.engine.joinRoom(socket, typed('break'))
    const breakRoom = await h.engine.joinCall(socket, { audio: true, video: false })
    expect(breakRoom.ok).toBe(false)
    if (!breakRoom.ok) expect(breakRoom.code).toBe(Refusal.ROOM_NO_CALLS)
  })

  it('refuses a fifth participant with a message that says the number', async () => {
    const workspace = named('Workspace')
    for (const name of ['One', 'Two', 'Three', 'Four']) {
      const socket = await h.enter({ name })
      await h.engine.joinRoom(socket, workspace)
      expect((await h.engine.joinCall(socket, { audio: true, video: false })).ok).toBe(true)
    }

    const fifth = await inWorkspace('Five')
    const result = await h.engine.joinCall(fifth, { audio: true, video: false })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(Refusal.CALL_FULL)
      expect(result.message).toContain('4')
    }
  })

  it('refuses to leave a call nobody is in', async () => {
    const socket = await inWorkspace('Ada')
    const result = await h.engine.leaveCall(socket)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe(Refusal.NOT_IN_CALL)
  })

  it('asks the identity adapter whether this person may join a call', async () => {
    const restricted = harness({
      identity: {
        ...typedEmailIdentity(),
        async may({ permission }): Promise<Decision> {
          if (permission === 'join_call') {
            return { allowed: false, code: 'call.plan', message: 'Not on this plan.' }
          }
          return { allowed: true }
        },
      },
    })
    const workspace = restricted.template.rooms.find((room) => room.name === 'Workspace')?.id ?? ''
    const socket = await restricted.enter({ name: 'Ada' })
    await restricted.engine.joinRoom(socket, workspace)

    const result = await restricted.engine.joinCall(socket, { audio: true, video: false })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toBe('Not on this plan.')
  })

  it('tells a new arrival who is already there, and never lists them to themselves', async () => {
    const ada = await inWorkspace('Ada')
    await h.engine.joinCall(ada, { audio: true, video: false })

    const grace = await inWorkspace('Grace')
    const joined = await h.engine.joinCall(grace, { audio: true, video: false })

    expect(joined.ok).toBe(true)
    if (!joined.ok) return
    // A peer connecting to itself is the first bug a mesh ever has.
    expect(joined.call.participants.map((one) => one.displayName)).toEqual(['Ada'])
  })
})

describe('leaving the room leaves the call', () => {
  let h: Harness
  beforeEach(() => {
    h = harness()
  })

  const named = (name: string) => h.template.rooms.find((room) => room.name === name)?.id ?? ''

  it('walks out of the conversation when it walks out of the room', async () => {
    const socket = await h.enter({ name: 'Ada' })
    await h.engine.joinRoom(socket, named('Workspace'))
    await h.engine.joinCall(socket, { audio: true, video: false })

    await h.engine.joinRoom(socket, h.template.rooms.find((room) => room.type === 'reception')!.id)

    // The conversation belongs to the room, so the call is left behind and the
    // status stops saying in a call.
    const snapshot = await h.engine.snapshot(socket)
    expect(snapshot.calls).toHaveLength(0)
    expect(snapshot.people[0]?.status).toBe('available')
  })

  it('ends a screen share along with the call it belonged to', async () => {
    const socket = await h.enter({ name: 'Ada' })
    await h.engine.joinRoom(socket, named('Workspace'))
    await h.engine.joinCall(socket, { audio: true, video: true })
    await h.engine.setMediaState(socket, { muted: false, cameraOn: true, sharing: true })

    await h.engine.leaveRoom(socket)

    // A share belongs to the conversation rather than to the person, so it cannot
    // follow them out.
    const device = (await h.engine.snapshot(socket)).people[0]?.devices[0]
    expect(device).toMatchObject({ inCall: false, sharing: false })
  })

  it('ends the leg when access is revoked, the same way leaving does', async () => {
    const socket = await h.enter({ name: 'Ada' })
    const userId = (await h.engine.snapshot(socket)).you.userId
    await h.engine.joinRoom(socket, named('Workspace'))
    await h.engine.joinCall(socket, { audio: true, video: false })
    await h.flush()
    h.sent.clear()

    h.events.publish({ type: 'access.revoked', userId, reason: 'Your access ended.' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    await h.flush()

    // One path out, so there is one place for it to be wrong.
    expect(changes(h.sent)).toContainEqual({ kind: 'call.ended', roomId: named('Workspace') })
  })
})

describe('a second device', () => {
  let h: Harness
  beforeEach(() => {
    h = harness()
  })

  const named = (name: string) => h.template.rooms.find((room) => room.name === name)?.id ?? ''

  /** One person, two devices, both in the workspace. */
  async function twoDevices() {
    const laptop = await h.enter({ name: 'Ada', deviceId: 'laptop' })
    const phone = await h.enter({
      name: 'Ada',
      deviceId: 'phone',
      kind: 'mobile',
      connectionId: 'socket-phone',
    })
    await h.engine.joinRoom(laptop, named('Workspace'))
    return { laptop, phone }
  }

  it('moves the call to the new device by default, leaving the first as presence', async () => {
    const { laptop, phone } = await twoDevices()
    await h.engine.joinCall(laptop, { audio: true, video: false })

    const moved = await h.engine.joinCall(phone, { audio: true, video: false })
    expect(moved.ok).toBe(true)
    if (!moved.ok) return

    // The common case, and the default: two live microphones in one place feed
    // back into each other.
    expect(moved.call.note).toBe('moved')
    expect(moved.call.call.participants.map((one) => one.deviceId)).toEqual(['phone'])

    const devices = (await h.engine.snapshot(laptop)).people[0]?.devices ?? []
    expect(devices.find((one) => one.deviceId === 'laptop')?.inCall).toBe(false)
    expect(devices.find((one) => one.deviceId === 'phone')?.inCall).toBe(true)
  })

  it('adds the device when asked, counted as its own leg', async () => {
    const { laptop, phone } = await twoDevices()
    await h.engine.joinCall(laptop, { audio: true, video: false })

    const added = await h.engine.joinCall(phone, { audio: true, video: true, secondDevice: 'add' })
    expect(added.ok).toBe(true)
    if (!added.ok) return

    // A real leg in the mesh, so it counts against the cap like anybody else.
    expect(added.call.note).toBe('added')
    expect(added.call.call.participants).toHaveLength(2)
  })

  it('adds it with the microphone off, whatever was asked for', async () => {
    const { laptop, phone } = await twoDevices()
    await h.engine.joinCall(laptop, { audio: true, video: false })
    await h.engine.joinCall(phone, { audio: true, video: true, secondDevice: 'add' })

    // Two live audio paths in the same physical room feed back into each other,
    // and the second device is almost always there for its camera.
    const devices = (await h.engine.snapshot(phone)).people[0]?.devices ?? []
    expect(devices.find((one) => one.deviceId === 'phone')).toMatchObject({
      inCall: true,
      muted: true,
      cameraOn: true,
    })
  })

  it('lets an added device unmute, because the person may have moved rooms', async () => {
    const { laptop, phone } = await twoDevices()
    await h.engine.joinCall(laptop, { audio: true, video: false })
    await h.engine.joinCall(phone, { audio: false, video: true, secondDevice: 'add' })

    // Allowed, with the warning belonging to the control rather than to a refusal
    // here. The product should not decide for them.
    await h.engine.setMediaState(phone, { muted: false, cameraOn: true, sharing: false })

    const devices = (await h.engine.snapshot(phone)).people[0]?.devices ?? []
    expect(devices.find((one) => one.deviceId === 'phone')?.muted).toBe(false)
  })

  it('counts one person with two legs as one person in the room', async () => {
    const { laptop, phone } = await twoDevices()
    await h.engine.joinCall(laptop, { audio: true, video: false })
    await h.engine.joinCall(phone, { audio: false, video: true, secondDevice: 'add' })

    // Presence is per user. The call counts legs; the room counts people.
    const snapshot = await h.engine.snapshot(laptop)
    expect(snapshot.people).toHaveLength(1)
    expect(snapshot.calls[0]?.participants).toHaveLength(2)
  })

  it('leaves the call on both devices when the person leaves the room', async () => {
    const { laptop, phone } = await twoDevices()
    await h.engine.joinCall(laptop, { audio: true, video: false })
    await h.engine.joinCall(phone, { audio: false, video: true, secondDevice: 'add' })

    await h.engine.leaveRoom(laptop)

    // Presence is per user, so leaving the room leaves on both.
    expect((await h.engine.snapshot(laptop)).calls).toHaveLength(0)
  })
})

describe('a connection that drops mid-call', () => {
  const named = (h: Harness, name: string) =>
    h.template.rooms.find((room) => room.name === name)?.id ?? ''

  it('holds the seat so the room cannot fill past somebody coming back', async () => {
    const h = harness({ graceMs: 5000 })
    const workspace = named(h, 'Workspace')

    const ada = await h.enter({ name: 'Ada' })
    await h.engine.joinRoom(ada, workspace)
    await h.engine.joinCall(ada, { audio: true, video: false })

    await h.engine.disconnected(ada)

    // Still a participant: the leg is held, not dropped.
    const others = await h.enter({ name: 'Grace' })
    expect((await h.engine.snapshot(others)).calls[0]?.participants).toHaveLength(1)
  })

  it('rejoins in the state it left, without the person doing anything', async () => {
    const h = harness({ graceMs: 5000 })
    const workspace = named(h, 'Workspace')

    const ada = await h.enter({ name: 'Ada', deviceId: 'laptop' })
    await h.engine.joinRoom(ada, workspace)
    await h.engine.joinCall(ada, { audio: true, video: true })
    await h.engine.setMediaState(ada, { muted: true, cameraOn: true, sharing: true })

    await h.engine.disconnected(ada)
    const back = await h.enter({ name: 'Ada', deviceId: 'laptop', connectionId: 'socket-back' })
    const rejoined = await h.engine.joinCall(back, { audio: true, video: false })

    expect(rejoined.ok).toBe(true)
    if (!rejoined.ok) return

    // Same mute, same camera. The share is not restored: it belonged to a screen
    // that is no longer there.
    const devices = (await h.engine.snapshot(back)).people[0]?.devices ?? []
    expect(devices.find((one) => one.deviceId === 'laptop')).toMatchObject({
      inCall: true,
      muted: true,
      cameraOn: true,
      sharing: false,
    })
  })

  it('ends the leg once the grace period has gone', async () => {
    const h = harness({ graceMs: 30 })
    const workspace = named(h, 'Workspace')

    const ada = await h.enter({ name: 'Ada' })
    const grace = await h.enter({ name: 'Grace' })
    await h.engine.joinRoom(ada, workspace)
    await h.engine.joinCall(ada, { audio: true, video: false })

    await h.engine.disconnected(ada)
    await new Promise((resolve) => setTimeout(resolve, 80))

    expect((await h.engine.snapshot(grace)).calls).toHaveLength(0)
  })

  it('drops only that screen’s leg when another device is still there', async () => {
    const h = harness()
    const workspace = named(h, 'Workspace')

    const laptop = await h.enter({ name: 'Ada', deviceId: 'laptop' })
    const phone = await h.enter({
      name: 'Ada',
      deviceId: 'phone',
      kind: 'mobile',
      connectionId: 'socket-phone',
    })
    await h.engine.joinRoom(laptop, workspace)
    await h.engine.joinCall(laptop, { audio: true, video: false })
    await h.engine.joinCall(phone, { audio: false, video: true, secondDevice: 'add' })

    await h.engine.disconnected(laptop)

    // The person is still here, and still in the call, from one device.
    const snapshot = await h.engine.snapshot(phone)
    expect(snapshot.people).toHaveLength(1)
    expect(snapshot.calls[0]?.participants.map((one) => one.deviceId)).toEqual(['phone'])
  })
})

describe('what a host can attach', () => {
  it('reports a call, its participants and its end, without the engine knowing why', async () => {
    const seen: string[] = []
    const h = harness({
      callHooks: {
        onCallStarted: () => seen.push('call.started'),
        onParticipantJoined: (context) => seen.push(`joined:${context.deviceId}`),
        onParticipantLeft: (event) => seen.push(`left:${event.deviceId}`),
        onCallEnded: () => seen.push('call.ended'),
      },
    })
    const workspace = h.template.rooms.find((room) => room.name === 'Workspace')?.id ?? ''

    const ada = await h.enter({ name: 'Ada', deviceId: 'laptop' })
    await h.engine.joinRoom(ada, workspace)
    await h.engine.joinCall(ada, { audio: true, video: false })
    await h.engine.leaveCall(ada)

    // Called by the call model rather than by the provider, so a provider cannot
    // forget to report.
    expect(seen).toEqual(['call.started', 'joined:laptop', 'left:laptop', 'call.ended'])
  })

  it('passes quality samples straight through, with the relayed flag that costs money', async () => {
    const samples: Array<{ relayed: boolean; peerDeviceId: string }> = []
    const h = harness({ callHooks: { onQualitySample: (event) => samples.push(event) } })
    const workspace = h.template.rooms.find((room) => room.name === 'Workspace')?.id ?? ''

    const ada = await h.enter({ name: 'Ada' })
    await h.engine.joinRoom(ada, workspace)
    await h.engine.joinCall(ada, { audio: true, video: false })

    await h.engine.reportQuality(ada, {
      peerDeviceId: 'device-2',
      relayed: true,
      packetLoss: 0.02,
      roundTripMs: 40,
    })

    expect(samples).toHaveLength(1)
    expect(samples[0]).toMatchObject({ relayed: true, peerDeviceId: 'device-2' })
  })

  it('works with no hooks bound at all, which is how this app runs', async () => {
    // The whole mechanism costs nothing when nobody is listening.
    const h = harness()
    const workspace = h.template.rooms.find((room) => room.name === 'Workspace')?.id ?? ''

    const ada = await h.enter({ name: 'Ada' })
    await h.engine.joinRoom(ada, workspace)

    expect((await h.engine.joinCall(ada, { audio: true, video: false })).ok).toBe(true)
    expect((await h.engine.leaveCall(ada)).ok).toBe(true)
  })
})

describe('relaying signalling', () => {
  let h: Harness
  beforeEach(() => {
    h = harness()
  })

  const named = (name: string) => h.template.rooms.find((room) => room.name === name)?.id ?? ''

  /** Two people in one call, which is the only place signalling is allowed. */
  async function inCall() {
    const workspace = named('Workspace')
    const ada = await h.enter({ name: 'Ada', deviceId: 'ada-laptop' })
    const grace = await h.enter({ name: 'Grace', deviceId: 'grace-laptop' })
    await h.engine.joinRoom(ada, workspace)
    await h.engine.joinRoom(grace, workspace)
    await h.engine.joinCall(ada, { audio: true, video: false })
    await h.engine.joinCall(grace, { audio: true, video: false })
    h.sent.clear()
    return { ada, grace }
  }

  it('passes an offer to the addressed leg, and to nobody else', async () => {
    const { ada } = await inCall()

    await h.engine.signal(ada, { to: 'grace-laptop', type: 'offer', payload: { sdp: 'v=0' } })

    expect(h.sent.connections).toHaveLength(1)
    expect(h.sent.connections[0]?.event).toBe('signal')
    expect(h.sent.connections[0]?.payload).toMatchObject({
      // Filled in by the server rather than trusted from the sender, so nobody
      // can claim to be somebody else's camera.
      from: 'ada-laptop',
      to: 'grace-laptop',
      type: 'offer',
    })
  })

  it('does not look inside the payload', async () => {
    const { ada } = await inCall()
    const payload = { sdp: 'whatever the browser said', candidates: [1, 2, 3] }

    await h.engine.signal(ada, { to: 'grace-laptop', type: 'candidate', payload })

    // Opaque on purpose: it is what keeps the core out of the media path, and it
    // is why this relay could carry a different provider's signalling unchanged.
    expect((h.sent.connections[0]?.payload as { payload: unknown }).payload).toEqual(payload)
  })

  it('goes nowhere when the sender is not in a call', async () => {
    const workspace = named('Workspace')
    const ada = await h.enter({ name: 'Ada', deviceId: 'ada-laptop' })
    const grace = await h.enter({ name: 'Grace', deviceId: 'grace-laptop' })
    await h.engine.joinRoom(ada, workspace)
    await h.engine.joinRoom(grace, workspace)
    await h.engine.joinCall(grace, { audio: true, video: false })
    h.sent.clear()

    // Otherwise anybody in the office could signal into a conversation they are
    // not part of.
    await h.engine.signal(ada, { to: 'grace-laptop', type: 'offer', payload: {} })
    expect(h.sent.connections).toHaveLength(0)
  })

  it('goes nowhere when the addressed leg is not in the call', async () => {
    const { ada } = await inCall()
    const outsider = await h.enter({ name: 'Alan', deviceId: 'alan-laptop' })
    void outsider

    // The address is not a way to reach an arbitrary socket.
    await h.engine.signal(ada, { to: 'alan-laptop', type: 'offer', payload: {} })
    expect(h.sent.connections).toHaveLength(0)
  })

  it('never crosses between rooms', async () => {
    // Two calls, in two rooms, at the same time. A device id from one is not an
    // address in the other.
    const studio = named('Workspace')
    const ada = await h.enter({ name: 'Ada', deviceId: 'ada-laptop' })
    await h.engine.joinRoom(ada, studio)
    await h.engine.joinCall(ada, { audio: true, video: false })

    const elsewhere = h.template.rooms.find((room) => room.type === 'meeting')
    if (elsewhere) {
      const grace = await h.enter({ name: 'Grace', deviceId: 'grace-laptop' })
      await h.engine.joinRoom(grace, elsewhere.id)
      await h.engine.joinCall(grace, { audio: true, video: false })
      h.sent.clear()

      await h.engine.signal(ada, { to: 'grace-laptop', type: 'offer', payload: {} })
      expect(h.sent.connections).toHaveLength(0)
    }
  })

  it('stops relaying once a leg has left the call', async () => {
    const { ada, grace } = await inCall()
    await h.engine.leaveCall(grace)
    h.sent.clear()

    await h.engine.signal(ada, { to: 'grace-laptop', type: 'offer', payload: {} })
    expect(h.sent.connections).toHaveLength(0)
  })

  it('ignores a message from a socket that has not entered the office', async () => {
    h.engine.connected({ connectionId: 'stranger', deviceId: 'stranger', kind: 'web' })
    await h.engine.signal('stranger', { to: 'anybody', type: 'offer', payload: {} })
    expect(h.sent.connections).toHaveLength(0)
  })
})
