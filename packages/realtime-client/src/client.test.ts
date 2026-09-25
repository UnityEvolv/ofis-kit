import type {
  DeviceKind,
  OfficeSnapshot,
  PublicPresence,
} from '@unityevolv/ofiskit-realtime-core/protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createOfisClient, type ClientEvent, type SocketLike } from './client.js'

/**
 * The client, driven without a network.
 *
 * What is worth testing here is what happens to the office state when a diff
 * skips a number or a move is refused, and none of that needs a socket to be
 * true. A fake one makes those cases reachable, and deterministic: a real socket
 * would turn every assertion into a wait.
 */

interface Fake extends SocketLike {
  /** Fire a server event at the client, as the socket would. */
  fire(event: string, ...args: unknown[]): void
  /** Everything the client sent, in order. */
  sent: Array<{ event: string; payload?: unknown }>
  /** Answer the next request for an event with this result. */
  answer(event: string, result: unknown): void
}

function fakeSocket(): Fake {
  const handlers = new Map<string, Array<(...args: never[]) => void>>()
  const answers = new Map<string, unknown>()
  const sent: Fake['sent'] = []

  const socket: Fake = {
    sent,

    on(event, handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])
      return socket
    },
    off(event, handler) {
      handlers.set(
        event,
        (handlers.get(event) ?? []).filter((one) => one !== handler),
      )
      return socket
    },

    emit(event, ...args) {
      const ack = args.at(-1)
      const payload = typeof ack === 'function' ? args.at(-2) : args.at(-1)
      sent.push({ event, ...(payload === undefined ? {} : { payload }) })

      // Acknowledged synchronously when the test has said what to answer, which
      // is what makes the awaits in these tests resolve without a timer.
      if (typeof ack === 'function' && answers.has(event)) {
        ;(ack as (result: unknown) => void)(answers.get(event))
      }
      return socket
    },

    disconnect() {
      return socket
    },

    io: {
      on(event, handler) {
        handlers.set(`io:${event}`, [...(handlers.get(`io:${event}`) ?? []), handler])
        return socket.io
      },
    },

    fire(event, ...args) {
      for (const handler of handlers.get(event) ?? []) {
        ;(handler as (...given: unknown[]) => void)(...args)
      }
    },

    answer(event, result) {
      answers.set(event, result)
    },
  }

  return socket
}

/**
 * A device with nothing happening on it, which is the ordinary case.
 *
 * A helper because the call fields are required and almost never the point of the
 * test: a fixture spelling out five falses is noise around the one field that
 * matters.
 */
function device(deviceId: string, kind: DeviceKind = 'web'): PublicPresence['devices'][number] {
  return {
    deviceId,
    kind,
    inCall: false,
    muted: true,
    cameraOn: false,
    sharing: false,
    speaking: false,
    lastSpokeAt: null,
    handRaisedAt: null,
  }
}

function person(overrides: Partial<PublicPresence> & { userId: string }): PublicPresence {
  return {
    displayName: overrides.userId,
    roomId: 'reception',
    devices: [device(`${overrides.userId}-laptop`)],
    status: 'available',
    arrivedAt: '2026-01-01T09:00:00.000Z',
    ...overrides,
  }
}

function snapshot(overrides: Partial<OfficeSnapshot> = {}): OfficeSnapshot {
  return {
    officeId: 'office',
    seq: 1,
    people: [person({ userId: 'ada' })],
    locks: [],
    calls: [],
    you: { userId: 'ada', deviceId: 'ada-laptop', manual: null },
    ...overrides,
  }
}

/** A client already in the office, with the socket the test can drive. */
async function entered(options: { snapshot?: OfficeSnapshot } = {}) {
  const socket = fakeSocket()
  const events: ClientEvent[] = []

  const client = createOfisClient({
    url: 'http://localhost',
    deviceId: 'ada-laptop',
    connect: () => socket,
  })
  client.on((event) => events.push(event))

  socket.answer('office:enter', { ok: true, snapshot: options.snapshot ?? snapshot() })
  const result = await client.enter({ email: 'ada@example.com', name: 'Ada' })
  expect(result.ok).toBe(true)

  return { client, socket, events }
}

/**
 * Let the microtasks run.
 *
 * A resync is started by a socket event and finished on a promise, so a test that
 * asserts straight after firing the event is asserting one tick too early.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  vi.useRealTimers()
})

describe('entering', () => {
  it('sends the credentials with the device, and holds the snapshot it gets back', async () => {
    const { client, socket } = await entered()

    expect(socket.sent[0]).toMatchObject({
      event: 'office:enter',
      payload: { deviceId: 'ada-laptop', kind: 'web' },
    })
    expect(client.state().ready).toBe(true)
    expect(client.state().people.size).toBe(1)
    expect(client.status()).toBe('connected')
  })

  it('stays out, and says so, when the office refuses', async () => {
    const socket = fakeSocket()
    const client = createOfisClient({ url: 'x', deviceId: 'd', connect: () => socket })

    socket.answer('office:enter', {
      ok: false,
      code: 'identity.email_invalid',
      message: 'That is not an email.',
    })
    const result = await client.enter({ email: 'nope' })

    expect(result.ok).toBe(false)
    expect(client.state().ready).toBe(false)
    expect(client.status()).toBe('idle')
  })

  it('walks back in by itself after a reconnect, without asking again', async () => {
    // The credentials are already in hand, so somebody whose train came out of a
    // tunnel is back in their room having touched nothing.
    const { socket } = await entered()
    socket.sent.length = 0

    socket.fire('connect')

    expect(socket.sent.map((one) => one.event)).toContain('office:enter')
  })

  it('reports reconnecting while the socket is down', async () => {
    const { client, socket, events } = await entered()

    socket.fire('disconnect')
    expect(client.status()).toBe('reconnecting')
    expect(events).toContainEqual({ type: 'status', status: 'reconnecting' })
  })
})

describe('diffs', () => {
  it('applies one and notifies whoever is watching', async () => {
    const { client, socket } = await entered()
    const seen: number[] = []
    client.subscribe((state) => seen.push(state.people.size))

    socket.fire('office:diff', {
      seq: 2,
      changes: [{ kind: 'person.entered', presence: person({ userId: 'grace' }) }],
    })

    expect(client.state().people.size).toBe(2)
    expect(seen).toEqual([2])
  })

  it('asks for a fresh snapshot when a number is skipped', async () => {
    const { client, socket } = await entered()
    socket.answer('office:resync', {
      ok: true,
      snapshot: snapshot({
        seq: 9,
        people: [person({ userId: 'ada' }), person({ userId: 'grace' })],
      }),
    })

    socket.fire('office:diff', { seq: 5, changes: [] })
    await settle()

    // Not a guess, and not a screen that stays wrong until somebody reloads.
    expect(socket.sent.map((one) => one.event)).toContain('office:resync')
    expect(client.state().seq).toBe(9)
    expect(client.state().people.size).toBe(2)
  })

  it('asks once for a burst of out-of-order diffs, not once each', async () => {
    const { socket } = await entered()
    socket.answer('office:resync', { ok: true, snapshot: snapshot({ seq: 9 }) })

    socket.fire('office:diff', { seq: 5, changes: [] })
    socket.fire('office:diff', { seq: 6, changes: [] })
    socket.fire('office:diff', { seq: 7, changes: [] })
    await settle()

    // A resync is a whole office, which is what diffs exist to avoid sending.
    expect(socket.sent.filter((one) => one.event === 'office:resync')).toHaveLength(1)
  })

  it('ignores a diff it has already applied', async () => {
    const { client, socket } = await entered()

    socket.fire('office:diff', {
      seq: 1,
      changes: [{ kind: 'person.entered', presence: person({ userId: 'grace' }) }],
    })

    expect(client.state().people.size).toBe(1)
    expect(socket.sent.map((one) => one.event)).not.toContain('office:resync')
  })
})

describe('moving', () => {
  it('moves your own avatar immediately, before the server has answered', async () => {
    const socket = fakeSocket()
    const client = createOfisClient({ url: 'x', deviceId: 'ada-laptop', connect: () => socket })
    socket.answer('office:enter', { ok: true, snapshot: snapshot() })
    await client.enter({})

    // No answer registered for room:join, so the request is left hanging — which
    // is exactly the moment worth looking at. Waiting a round trip to watch your
    // own click land feels broken.
    void client.joinRoom('studio')

    expect(client.state().people.get('ada')?.roomId).toBe('studio')
  })

  it('snaps back and says why when the move is refused', async () => {
    const { client, socket, events } = await entered()
    socket.answer('room:join', { ok: false, code: 'room.locked', message: 'Studio is locked.' })

    const result = await client.joinRoom('studio')

    expect(result.ok).toBe(false)
    expect(client.state().people.get('ada')?.roomId).toBe('reception')
    expect(events).toContainEqual({
      type: 'refused',
      action: 'room:join',
      code: 'room.locked',
      message: 'Studio is locked.',
    })
  })

  it('leaves the guess in place when the move is allowed', async () => {
    const { client, socket } = await entered()
    socket.answer('room:join', { ok: true })

    await client.joinRoom('studio')

    // The diff that follows is what makes it true; this is only the guess not
    // being thrown away for no reason.
    expect(client.state().people.get('ada')?.roomId).toBe('studio')
  })

  it('lets the server’s answer win when two devices move at once', async () => {
    const { client, socket } = await entered()
    socket.answer('room:join', { ok: true })
    await client.joinRoom('studio')

    // The other device won, and the diff says so. It overwrites the guess rather
    // than being merged with it.
    socket.fire('office:diff', {
      seq: 2,
      changes: [
        {
          kind: 'person.moved',
          userId: 'ada',
          roomId: 'library',
          arrivedAt: '2026-01-01T10:00:00.000Z',
        },
      ],
    })

    expect(client.state().people.get('ada')?.roomId).toBe('library')
  })
})

describe('the connection ending', () => {
  it('stops retrying when the office says it is over, and says why', async () => {
    const { client, socket, events } = await entered()

    socket.fire('disconnected', { code: 'auth.revoked', message: 'Your access ended.' })

    expect(client.status()).toBe('closed')
    expect(events).toContainEqual({
      type: 'closed',
      code: 'auth.revoked',
      message: 'Your access ended.',
    })

    // Retrying a revoked credential forever helps nobody, so a reconnect does not
    // walk back in.
    socket.sent.length = 0
    socket.fire('connect')
    expect(socket.sent.map((one) => one.event)).not.toContain('office:enter')
  })

  it('empties the office when the person leaves', async () => {
    const { client, socket } = await entered()
    socket.answer('office:leave', { ok: true })

    await client.leave()

    expect(client.state().ready).toBe(false)
    expect(client.state().people.size).toBe(0)
  })

  it('answers a request that never comes back rather than hanging forever', async () => {
    vi.useFakeTimers()
    const socket = fakeSocket()
    const client = createOfisClient({ url: 'x', deviceId: 'd', connect: () => socket })

    const pending = client.joinRoom('studio')
    await vi.advanceTimersByTimeAsync(10_000)
    const result = await pending

    // A request with no answer is not a refusal and must not look like one: the
    // message says to try again, where a refusal would say why not to.
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('client.timeout')
  })

  it('sends a heartbeat on a schedule, and stops on the way out', async () => {
    vi.useFakeTimers()
    const socket = fakeSocket()
    const client = createOfisClient({
      url: 'x',
      deviceId: 'd',
      heartbeatMs: 1000,
      connect: () => socket,
    })
    socket.answer('office:enter', { ok: true, snapshot: snapshot() })
    await client.enter({})

    await vi.advanceTimersByTimeAsync(3500)
    const beats = socket.sent.filter((one) => one.event === 'heartbeat').length
    expect(beats).toBe(3)

    client.close()
    await vi.advanceTimersByTimeAsync(5000)
    expect(socket.sent.filter((one) => one.event === 'heartbeat')).toHaveLength(beats)
  })
})

describe('a share taken over', () => {
  /** Enough of a provider to see what the client asks it to do. */
  function fakeRtc() {
    return {
      join: vi.fn(async () => {}),
      leave: vi.fn(async () => {}),
      setMicrophone: vi.fn(async () => {}),
      setCamera: vi.fn(async () => {}),
      startScreenShare: vi.fn(async () => true),
      stopScreenShare: vi.fn(async () => {}),
      setVideoSubscriptions: vi.fn(),
      useDevices: vi.fn(async () => {}),
      on: vi.fn(() => () => {}),
    }
  }

  async function withRtc() {
    const socket = fakeSocket()
    const rtc = fakeRtc()
    const events: ClientEvent[] = []

    const client = createOfisClient({
      url: 'http://localhost',
      deviceId: 'ada-laptop',
      connect: () => socket,
      rtc: () => rtc,
    })
    client.on((event) => events.push(event))

    socket.answer('office:enter', { ok: true, snapshot: snapshot() })
    await client.enter({ email: 'ada@example.com', name: 'Ada' })

    return { socket, rtc, events }
  }

  it('stops the capture without being asked twice', async () => {
    const { socket, rtc } = await withRtc()

    socket.fire('call:share_ended', {
      roomId: 'studio',
      reason: 'taken_over',
      byUserId: 'grace',
    })

    /*
     * Here rather than in the UI, because it is not a drawing decision: the
     * operating system is recording a screen, the server has given the slot to
     * somebody else, and a client that only redrew would go on capturing for
     * nobody.
     */
    expect(rtc.stopScreenShare).toHaveBeenCalledTimes(1)
  })

  it('says who took it, so the person can be told rather than left guessing', async () => {
    const { socket, events } = await withRtc()

    socket.fire('call:share_ended', {
      roomId: 'studio',
      reason: 'taken_over',
      byUserId: 'grace',
    })

    expect(events.at(-1)).toEqual({
      type: 'share.ended',
      roomId: 'studio',
      reason: 'taken_over',
      byUserId: 'grace',
    })
  })
})

describe('the call following the office', () => {
  function fakeRtc() {
    return {
      join: vi.fn(async () => {}),
      leave: vi.fn(async () => {}),
      removeParticipant: vi.fn(),
      setMicrophone: vi.fn(async () => {}),
      setCamera: vi.fn(async () => {}),
      startScreenShare: vi.fn(async () => true),
      stopScreenShare: vi.fn(async () => {}),
      setVideoSubscriptions: vi.fn(),
      useDevices: vi.fn(async () => {}),
      on: vi.fn(() => () => {}),
    }
  }

  function call(...deviceIds: string[]) {
    return {
      roomId: 'studio',
      provider: 'p2p',
      startedAt: '2026-01-01T09:00:00.000Z',
      participants: deviceIds.map((deviceId) => ({ userId: deviceId.split('-')[0]!, deviceId })),
      limit: 4,
      sharing: null,
    }
  }

  /** Ada in the studio's call with Grace, the leg already seen in a diff. */
  async function inCall() {
    const socket = fakeSocket()
    const rtc = fakeRtc()
    const client = createOfisClient({
      url: 'http://localhost',
      deviceId: 'ada-laptop',
      connect: () => socket,
      rtc: () => rtc,
    })
    socket.answer('office:enter', {
      ok: true,
      snapshot: snapshot({
        people: [person({ userId: 'ada', roomId: 'studio' })],
        calls: [call('grace-laptop')],
      }),
    })
    await client.enter({ email: 'ada@example.com', name: 'Ada' })

    socket.answer('call:join', {
      ok: true,
      call: {
        call: call('grace-laptop', 'ada-laptop'),
        credentials: null,
        iceServers: [],
        participants: [{ userId: 'grace', deviceId: 'grace-laptop', displayName: 'Grace' }],
      },
    })
    await client.joinCall({ audio: true, video: false })
    socket.fire('office:diff', {
      seq: 2,
      changes: [{ kind: 'call.updated', call: call('grace-laptop', 'ada-laptop') }],
    })

    return { client, socket, rtc }
  }

  it('stops the media here when the server ends this leg, however it ended', async () => {
    const { socket, rtc } = await inCall()

    // Moving room ends the leg on the server; this is how the client hears it.
    socket.fire('office:diff', {
      seq: 3,
      changes: [{ kind: 'call.updated', call: call('grace-laptop') }],
    })

    expect(rtc.leave).toHaveBeenCalledTimes(1)
  })

  it('does not leave before its own leg has been seen', async () => {
    const socket = fakeSocket()
    const rtc = fakeRtc()
    const client = createOfisClient({
      url: 'http://localhost',
      deviceId: 'ada-laptop',
      connect: () => socket,
      rtc: () => rtc,
    })
    socket.answer('office:enter', {
      ok: true,
      snapshot: snapshot({ calls: [call('grace-laptop')] }),
    })
    await client.enter({ email: 'ada@example.com', name: 'Ada' })
    socket.answer('call:join', {
      ok: true,
      call: {
        call: call('grace-laptop', 'ada-laptop'),
        credentials: null,
        iceServers: [],
        participants: [],
      },
    })
    await client.joinCall({ audio: true, video: false })

    // A diff from before the join landed: the call without us, which is not us leaving.
    socket.fire('office:diff', {
      seq: 2,
      changes: [{ kind: 'call.updated', call: call('grace-laptop') }],
    })

    expect(rtc.leave).not.toHaveBeenCalled()
  })

  it('closes the connection to somebody whose leg has gone, and only theirs', async () => {
    const { socket, rtc } = await inCall()

    socket.fire('office:diff', {
      seq: 3,
      changes: [{ kind: 'call.updated', call: call('ada-laptop') }],
    })

    expect(rtc.removeParticipant).toHaveBeenCalledWith('grace-laptop')
    expect(rtc.removeParticipant).toHaveBeenCalledTimes(1)
    expect(rtc.leave).not.toHaveBeenCalled()
  })

  it('stops following once the person leaves the call themselves', async () => {
    const { client, socket, rtc } = await inCall()
    socket.answer('call:leave', { ok: true })
    await client.leaveCall()

    socket.fire('office:diff', { seq: 3, changes: [{ kind: 'call.ended', roomId: 'studio' }] })

    expect(rtc.leave).toHaveBeenCalledTimes(1)
    expect(rtc.removeParticipant).not.toHaveBeenCalled()
  })
})
