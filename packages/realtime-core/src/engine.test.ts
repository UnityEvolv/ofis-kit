import {
  localEventBus,
  staticTemplateSource,
  typedEmailIdentity,
  type Decision,
  type IdentityAdapter,
} from '@unityevolv/ofiskit-adapters'
import { MemoryPresenceStore } from '@unityevolv/ofiskit-presence-store'
import { createTemplate, type Template } from '@unityevolv/ofiskit-template'
import { beforeEach, describe, expect, it } from 'vitest'

import { OfficeEngine } from './engine.js'
import { Refusal } from './protocol/index.js'
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

interface Harness {
  engine: OfficeEngine
  sent: Recorder
  store: MemoryPresenceStore
  template: Template
  events: ReturnType<typeof localEventBus>
  enter(options: {
    name: string
    deviceId?: string
    kind?: 'web' | 'desktop' | 'mobile'
    connectionId?: string
  }): Promise<string>
}

function harness(
  identity: IdentityAdapter = typedEmailIdentity(),
  roomCapacity?: (room: { id: string }) => number | null,
  graceMs?: number,
): Harness {
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
    ...(roomCapacity ? { roomCapacity } : {}),
    ...(graceMs === undefined ? {} : { graceMs }),
  })

  let counter = 0

  return {
    engine,
    sent,
    store,
    template,
    events,
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
      ...typedEmailIdentity(),
      async may(): Promise<Decision> {
        return { allowed: false, code: 'office.restricted', message: 'Members only.' }
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
    h.sent.clear()

    await h.engine.leaveOffice(socket)

    expect((await h.engine.snapshot(socket)).people).toHaveLength(0)
    expect(h.sent.office.some((one) => one.event === 'office:state')).toBe(true)
  })

  it('does not remove somebody the moment their last device drops', async () => {
    // This used to remove them immediately. It no longer does, deliberately:
    // a dropped connection now starts a grace period, so a wifi blip does not
    // make somebody vanish from a room. The removal is tested below.
    const h = harness(typedEmailIdentity(), undefined, 5000)
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
    h.sent.clear()

    const workspace = roomNamed('Workspace')
    expect((await h.engine.joinRoom(socket, workspace)).ok).toBe(true)

    expect((await h.engine.snapshot(socket)).people[0]?.roomId).toBe(workspace)
    expect(h.sent.office.some((one) => one.event === 'office:state')).toBe(true)
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
      ...typedEmailIdentity(),
      async may({ permission }): Promise<Decision> {
        if (permission === 'join_room') {
          return { allowed: false, code: 'room.restricted', message: 'The studio is invite only.' }
        }
        return { allowed: true }
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
    const limited = harness(typedEmailIdentity(), () => 1)
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
      ...typedEmailIdentity(),
      async onPresenceChanged(event) {
        seen.push({ roomId: event.roomId })
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
    const h = harness(typedEmailIdentity(), undefined, 300)
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
    const h = harness(typedEmailIdentity(), undefined, 60)
    const socket = await h.enter({ name: 'Ada' })

    await h.engine.disconnected(socket)
    await sleep(160)

    expect((await h.engine.snapshot(socket)).people).toHaveLength(0)
  })

  it('puts them back where they were when they return in time', async () => {
    const h = harness(typedEmailIdentity(), undefined, 400)
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
    const h = harness(typedEmailIdentity(), undefined, 5000)
    const socket = await h.enter({ name: 'Ada' })

    await h.engine.leaveOffice(socket)

    // They said they were going. Making everyone watch them linger for thirty
    // seconds would just be wrong.
    expect((await h.engine.snapshot(socket)).people).toHaveLength(0)
  })

  it('starts no grace period while another device is still open', async () => {
    const h = harness(typedEmailIdentity(), undefined, 60)
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
    const graced = harness(typedEmailIdentity(), undefined, 300)
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
