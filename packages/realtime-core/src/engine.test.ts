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

function harness(identity: IdentityAdapter = typedEmailIdentity()): Harness {
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

  it('removes somebody when their last device disconnects', async () => {
    const h = harness()
    const socket = await h.enter({ name: 'Ada' })
    await h.engine.disconnected(socket)
    expect((await h.engine.snapshot(socket)).people).toHaveLength(0)
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
