import {
  allow,
  idForEmail,
  localEventBus,
  memoryRateLimiter,
  refuse,
  staticTemplateSource,
  typedEmailIdentity,
  unlimited,
  type IdentityAdapter,
  type PermissionQuestion,
  type RateLimiter,
} from '@unityevolv/ofiskit-adapters'
import { MemoryPresenceStore } from '@unityevolv/ofiskit-presence-store'
import { addRoom, createTemplate, type Template } from '@unityevolv/ofiskit-template'
import { afterEach, describe, expect, it } from 'vitest'

import { builtInProvider } from './calls.js'
import { OfficeEngine } from './engine.js'
import { FOLLOW_DEFAULTS, type FollowOptions } from './follow.js'
import { NUDGE_DEFAULTS, type NudgeOptions } from './nudge.js'
import { Refusal, type FollowState, type OfficeChange } from './protocol/index.js'
import type { Transport } from './transport.js'

/**
 * Nudging and following, against a real engine with a recording transport.
 *
 * Both are links between two people that live in memory and nowhere else, so
 * most of what is tested here is what each person is told, and that nothing is
 * written anywhere it would outlive them.
 */

const OFFICE = 'office'

class Recorder implements Transport {
  toUsers: Array<{ userId: string; event: string; payload: unknown }> = []
  office: Array<{ event: string; payload: unknown }> = []

  toOffice(_officeId: string, event: string, payload: unknown) {
    this.office.push({ event, payload })
  }
  toRoom() {}
  toUser(userId: string, event: string, payload: unknown) {
    this.toUsers.push({ userId, event, payload })
  }
  toConnection() {}
  close() {}

  /** What one person was sent under one event name, oldest first. */
  to<T = Record<string, unknown>>(userId: string, event: string): T[] {
    return this.toUsers
      .filter((one) => one.userId === userId && one.event === event)
      .map((one) => one.payload as T)
  }

  last<T = Record<string, unknown>>(userId: string, event: string): T | undefined {
    return this.to<T>(userId, event).at(-1)
  }
}

function layout(): Template {
  const base = createTemplate({
    name: 'Test office',
    canvas: 'landscape',
    images: { light: 'o.webp' },
  })
  const withStudio = addRoom(base, 'meeting', { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, 'Studio')
  return addRoom(withStudio, 'meeting', { x: 0.6, y: 0.6, width: 0.2, height: 0.2 }, 'Library')
}

interface Options {
  identity?: IdentityAdapter
  limiter?: RateLimiter
  nudge?: Partial<NudgeOptions>
  follow?: Partial<FollowOptions>
  now?: () => number
  store?: MemoryPresenceStore
  events?: ReturnType<typeof localEventBus>
  template?: Template
  graceMs?: number
}

const engines: OfficeEngine[] = []

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.close()
})

function harness(options: Options = {}) {
  const sent = new Recorder()
  const template = options.template ?? layout()
  const store = options.store ?? new MemoryPresenceStore()
  const engine = new OfficeEngine({
    officeId: OFFICE,
    store,
    identity: options.identity ?? typedEmailIdentity(),
    templates: staticTemplateSource(template),
    transport: sent,
    events: options.events ?? localEventBus(),
    limiter: options.limiter ?? unlimited(),
    provider: builtInProvider(),
    diffWindowMs: 10_000,
    ...(options.nudge ? { nudge: options.nudge } : {}),
    ...(options.follow ? { follow: options.follow } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.graceMs === undefined ? {} : { graceMs: options.graceMs }),
  })
  engines.push(engine)

  let counter = 0
  const room = (name: string) => template.rooms.find((one) => one.name === name)?.id ?? ''

  return {
    engine,
    sent,
    store,
    template,
    room,
    /** Somebody walks in. Returns their socket and their id. */
    async enter(name: string, prefix = 'socket') {
      counter += 1
      const connectionId = `${prefix}-${counter}`
      engine.connected({ connectionId, deviceId: `${prefix}-device-${counter}`, kind: 'web' })
      const result = await engine.enter(connectionId, {
        credentials: { email: `${name.toLowerCase()}@example.com`, name },
        deviceId: `${prefix}-device-${counter}`,
        kind: 'web',
      })
      if (!result.ok) throw new Error(`could not enter: ${result.message}`)
      return { socket: connectionId, id: await idForEmail(`${name.toLowerCase()}@example.com`) }
    },
    async roomOf(userId: string) {
      return (await store.get(OFFICE, userId))?.roomId
    },
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('nudging', () => {
  it('reaches an available colleague with who, where and the line, and stores nothing', async () => {
    const office = harness()
    const priya = await office.enter('Priya')
    const alan = await office.enter('Alan')
    await office.engine.joinRoom(alan.socket, office.room('Library'))
    await office.engine.flush()
    const before = await office.store.list(OFFICE)
    const diffsBefore = office.sent.office.length

    const result = await office.engine.nudge(alan.socket, {
      userId: priya.id,
      line: '  got   a\nminute? ',
    })

    expect(result).toMatchObject({ ok: true, delivery: 'now' })
    expect(office.sent.last(priya.id, 'nudge:received')).toMatchObject({
      userId: alan.id,
      displayName: 'Alan',
      roomId: office.room('Library'),
      line: 'got a minute?',
      delivery: 'now',
    })

    // Not a row, not a diff, not a change to anybody's presence.
    await office.engine.flush()
    expect(office.sent.office.length).toBe(diffsBefore)
    expect(await office.store.list(OFFICE)).toEqual(before)
  })

  it('goes quietly to somebody in a call, held for when it ends', async () => {
    const office = harness()
    const priya = await office.enter('Priya')
    const alan = await office.enter('Alan')
    await office.engine.joinRoom(priya.socket, office.room('Studio'))
    await office.engine.joinCall(priya.socket, { audio: true, video: false })

    const result = await office.engine.nudge(alan.socket, { userId: priya.id })

    expect(result).toMatchObject({ ok: true, delivery: 'held' })
    expect(office.sent.last(priya.id, 'nudge:received')).toMatchObject({ delivery: 'held' })
  })

  it('is refused for do not disturb, with the reason, and never queued', async () => {
    const office = harness()
    const priya = await office.enter('Priya')
    const alan = await office.enter('Alan')
    await office.engine.setManualStatus(priya.socket, 'dnd')

    const result = await office.engine.nudge(alan.socket, { userId: priya.id })

    expect(result).toMatchObject({ ok: false, code: Refusal.NUDGE_DND })
    expect(!result.ok && result.message).toMatch(/Priya is on do not disturb/)
    expect(office.sent.to(priya.id, 'nudge:received')).toHaveLength(0)

    // Coming off do not disturb does not deliver it late.
    await office.engine.setManualStatus(priya.socket, null)
    expect(office.sent.to(priya.id, 'nudge:received')).toHaveLength(0)
  })

  it('is refused for away and for anybody not connected', async () => {
    const office = harness({ graceMs: 60_000 })
    const priya = await office.enter('Priya')
    const alan = await office.enter('Alan')
    const ghost = await idForEmail('ghost@example.com')

    office.engine.setActivity(priya.socket, { idle: true, foreground: true })
    await sleep(0)
    expect(await office.engine.nudge(alan.socket, { userId: priya.id })).toMatchObject({
      ok: false,
      code: Refusal.NUDGE_AWAY,
    })

    expect(await office.engine.nudge(alan.socket, { userId: ghost })).toMatchObject({
      ok: false,
      code: Refusal.NUDGE_OFFLINE,
    })

    // Reconnecting is not here either: a dropped connection loses the tap.
    await office.engine.disconnected(priya.socket)
    expect(await office.engine.nudge(alan.socket, { userId: priya.id })).toMatchObject({
      ok: false,
      code: Refusal.NUDGE_OFFLINE,
    })
  })

  it('refuses yourself, and anything that is not one short plain line', async () => {
    const office = harness()
    const priya = await office.enter('Priya')
    const alan = await office.enter('Alan')

    expect(await office.engine.nudge(alan.socket, { userId: alan.id })).toMatchObject({
      code: Refusal.NUDGE_SELF,
    })
    expect(
      await office.engine.nudge(alan.socket, { userId: priya.id, line: 'x'.repeat(281) }),
    ).toMatchObject({ code: Refusal.NUDGE_LINE_INVALID })
    expect(
      await office.engine.nudge(alan.socket, { userId: priya.id, line: 'bell\u0007' }),
    ).toMatchObject({ code: Refusal.NUDGE_LINE_INVALID })
    expect(
      await office.engine.nudge(alan.socket, { userId: priya.id, line: 'x'.repeat(280) }),
    ).toMatchObject({ ok: true })
    // An empty line is no line at all.
    await office.engine.nudge(alan.socket, { userId: priya.id, line: '   ' })
    expect(office.sent.last(priya.id, 'nudge:received')).not.toHaveProperty('line')
  })

  it('asks the host, about this person, and passes its refusal on whole', async () => {
    const asked: PermissionQuestion[] = []
    const host = typedEmailIdentity()
    const office = harness({
      identity: {
        authenticate: (credentials, context) => host.authenticate(credentials, context),
        async may(question) {
          asked.push(question)
          if (question.permission !== 'nudge') return allow()
          return {
            ...refuse(Refusal.NUDGE_OUT_OF_OFFICE, 'Priya is out of office.'),
            fields: { returns_on: '2026-10-14' },
          }
        },
      },
    })
    const priya = await office.enter('Priya')
    const alan = await office.enter('Alan')

    const result = await office.engine.nudge(alan.socket, { userId: priya.id })

    expect(asked.find((one) => one.permission === 'nudge')).toMatchObject({
      targetUserId: priya.id,
      identity: { id: alan.id },
    })
    expect(result).toEqual({
      ok: false,
      code: Refusal.NUDGE_OUT_OF_OFFICE,
      message: 'Priya is out of office.',
      fields: { returns_on: '2026-10-14' },
    })
  })

  it('allows three a minute to one person by default, and says who on the fourth', async () => {
    let clock = 1_000_000
    const office = harness({ limiter: memoryRateLimiter(() => clock), now: () => clock })
    const priya = await office.enter('Priya')
    const alan = await office.enter('Alan')

    for (let attempt = 0; attempt < NUDGE_DEFAULTS.perPersonLimit; attempt += 1) {
      expect(await office.engine.nudge(alan.socket, { userId: priya.id })).toMatchObject({
        ok: true,
      })
    }
    const fourth = await office.engine.nudge(alan.socket, { userId: priya.id })
    expect(fourth).toMatchObject({ ok: false, code: Refusal.NUDGE_RATE_LIMITED_PERSON })
    expect(!fourth.ok && fourth.message).toMatch(/You nudged Priya a moment ago/)
    expect(office.sent.to(priya.id, 'nudge:received')).toHaveLength(3)

    clock += 60_000
    expect(await office.engine.nudge(alan.socket, { userId: priya.id })).toMatchObject({
      ok: true,
    })
  })

  it('allows ten a minute overall by default, across everybody', async () => {
    const clock = 1_000_000
    const office = harness({ limiter: memoryRateLimiter(() => clock), now: () => clock })
    const alan = await office.enter('Alan')
    const colleagues = []
    for (const name of ['Ada', 'Bea', 'Cy', 'Dee']) colleagues.push(await office.enter(name))

    const outcomes = []
    for (const colleague of colleagues) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        outcomes.push(await office.engine.nudge(alan.socket, { userId: colleague.id }))
      }
    }

    expect(outcomes.filter((one) => one.ok)).toHaveLength(NUDGE_DEFAULTS.perSenderLimit)
    expect(outcomes.at(-1)).toMatchObject({ ok: false, code: Refusal.NUDGE_RATE_LIMITED })
  })

  it('takes its limits from configuration', async () => {
    const clock = 1_000_000
    const office = harness({
      limiter: memoryRateLimiter(() => clock),
      now: () => clock,
      nudge: { perPersonLimit: 1 },
    })
    const priya = await office.enter('Priya')
    const alan = await office.enter('Alan')

    expect(await office.engine.nudge(alan.socket, { userId: priya.id })).toMatchObject({
      ok: true,
    })
    // Twice in a row, refused with a reason somebody can read.
    expect(await office.engine.nudge(alan.socket, { userId: priya.id })).toMatchObject({
      ok: false,
      code: Refusal.NUDGE_RATE_LIMITED_PERSON,
    })
  })

  it('does not spend the budget on a refusal for status', async () => {
    const clock = 1_000_000
    const office = harness({
      limiter: memoryRateLimiter(() => clock),
      now: () => clock,
      nudge: { perPersonLimit: 1 },
    })
    const priya = await office.enter('Priya')
    const alan = await office.enter('Alan')
    await office.engine.setManualStatus(priya.socket, 'dnd')
    await office.engine.nudge(alan.socket, { userId: priya.id })
    await office.engine.setManualStatus(priya.socket, null)

    expect(await office.engine.nudge(alan.socket, { userId: priya.id })).toMatchObject({
      ok: true,
    })
  })
})

describe('following', () => {
  /** Alan asks to follow Priya and she says yes. */
  async function following(options: Options = {}) {
    const office = harness(options)
    const priya = await office.enter('Priya')
    const alan = await office.enter('Alan')
    const asked = await office.engine.requestFollow(alan.socket, priya.id)
    if (!asked.ok) throw new Error(asked.message)
    const accepted = await office.engine.acceptFollow(priya.socket, asked.requestId)
    if (!accepted.ok) throw new Error(accepted.message)
    return { office, priya, alan, requestId: asked.requestId }
  }

  it('is asked for: the request reaches them, and nothing starts until they answer', async () => {
    const office = harness()
    const priya = await office.enter('Priya')
    const alan = await office.enter('Alan')

    const asked = await office.engine.requestFollow(alan.socket, priya.id)

    expect(asked).toMatchObject({ ok: true, following: false })
    expect(office.sent.last(priya.id, 'follow:requested')).toMatchObject({
      userId: alan.id,
      displayName: 'Alan',
    })
    expect(office.sent.last<FollowState>(alan.id, 'follow:state')).toMatchObject({
      following: null,
      asking: { userId: priya.id },
    })

    // Asking again while she decides is the same request, not a second card.
    const again = await office.engine.requestFollow(alan.socket, priya.id)
    expect(again).toMatchObject({ ok: true, requestId: asked.ok ? asked.requestId : '' })
    expect(office.sent.to(priya.id, 'follow:requested')).toHaveLength(1)
  })

  it('once accepted, lands the follower in every room the colleague walks into', async () => {
    const { office, priya, alan } = await following()

    expect(office.sent.last<FollowState>(priya.id, 'follow:state')).toMatchObject({
      followers: [{ userId: alan.id }],
    })
    expect(office.sent.last<FollowState>(alan.id, 'follow:state')).toMatchObject({
      following: { userId: priya.id },
      asking: null,
    })

    await office.engine.joinRoom(priya.socket, office.room('Studio'))
    expect(await office.roomOf(alan.id)).toBe(office.room('Studio'))
    expect(office.sent.last(alan.id, 'follow:moved')).toEqual({
      leaderId: priya.id,
      roomId: office.room('Studio'),
    })

    await office.engine.joinRoom(priya.socket, office.room('Library'))
    expect(await office.roomOf(alan.id)).toBe(office.room('Library'))
  })

  it('brings the follower to where the colleague already is when it starts', async () => {
    const office = harness()
    const priya = await office.enter('Priya')
    const alan = await office.enter('Alan')
    await office.engine.joinRoom(priya.socket, office.room('Studio'))

    const asked = await office.engine.requestFollow(alan.socket, priya.id)
    await office.engine.acceptFollow(priya.socket, asked.ok ? asked.requestId : '')

    expect(await office.roomOf(alan.id)).toBe(office.room('Studio'))
  })

  it('leaves a follower outside a locked room with the reason, and keeps the follow', async () => {
    const { office, priya, alan } = await following()
    const carol = await office.enter('Carol')
    await office.engine.joinRoom(carol.socket, office.room('Studio'))
    await office.engine.lock(carol.socket, office.room('Studio'))
    office.engine.admitUser(OFFICE, office.room('Studio'), priya.id)

    await office.engine.joinRoom(priya.socket, office.room('Studio'))

    expect(await office.roomOf(priya.id)).toBe(office.room('Studio'))
    expect(await office.roomOf(alan.id)).not.toBe(office.room('Studio'))
    expect(office.sent.last(alan.id, 'follow:held')).toMatchObject({
      leaderId: priya.id,
      roomId: office.room('Studio'),
      code: Refusal.ROOM_LOCKED,
    })
    expect(office.sent.to(alan.id, 'follow:ended')).toHaveLength(0)

    // The next move picks them up again.
    await office.engine.joinRoom(priya.socket, office.room('Library'))
    expect(await office.roomOf(alan.id)).toBe(office.room('Library'))
  })

  it('never uses the follower to get somebody else past a door they may not open', async () => {
    const host = typedEmailIdentity()
    const template = layout()
    const studio = template.rooms.find((one) => one.name === 'Studio')?.id
    const office = harness({
      template,
      identity: {
        authenticate: (credentials, context) => host.authenticate(credentials, context),
        async may(question) {
          const restricted = question.permission === 'join_room' && question.roomId === studio
          return restricted && question.identity.displayName === 'Alan'
            ? refuse(Refusal.ROOM_FORBIDDEN, 'That room is restricted.')
            : allow()
        },
      },
    })
    const priya = await office.enter('Priya')
    const alan = await office.enter('Alan')
    const asked = await office.engine.requestFollow(alan.socket, priya.id)
    await office.engine.acceptFollow(priya.socket, asked.ok ? asked.requestId : '')

    await office.engine.joinRoom(priya.socket, office.room('Studio'))

    expect(await office.roomOf(alan.id)).not.toBe(office.room('Studio'))
    expect(office.sent.last(alan.id, 'follow:held')).toMatchObject({
      code: Refusal.ROOM_FORBIDDEN,
    })
  })

  it('ends when the follower walks somewhere by themselves', async () => {
    const { office, priya, alan } = await following()

    await office.engine.joinRoom(alan.socket, office.room('Library'))

    const ended = { leaderId: priya.id, followerId: alan.id, reason: 'moved_away' }
    expect(office.sent.last(alan.id, 'follow:ended')).toEqual(ended)
    expect(office.sent.last(priya.id, 'follow:ended')).toEqual(ended)
    await office.engine.joinRoom(priya.socket, office.room('Studio'))
    expect(await office.roomOf(alan.id)).toBe(office.room('Library'))
  })

  it('can be stopped from either side', async () => {
    const first = await following()
    expect(await first.office.engine.stopFollowing(first.alan.socket)).toEqual({ ok: true })
    expect(first.office.sent.last(first.priya.id, 'follow:ended')).toMatchObject({
      reason: 'stopped',
    })
    expect(await first.office.engine.stopFollowing(first.alan.socket)).toMatchObject({
      code: Refusal.FOLLOW_NOT_FOLLOWING,
    })

    const second = await following()
    expect(await second.office.engine.removeFollower(second.priya.socket, second.alan.id)).toEqual({
      ok: true,
    })
    expect(second.office.sent.last(second.alan.id, 'follow:ended')).toMatchObject({
      reason: 'removed',
    })
    expect(
      second.office.sent.last<FollowState>(second.priya.id, 'follow:state')?.followers,
    ).toEqual([])
  })

  it('tells only the asker about a decline, and makes them wait ten minutes to ask again', async () => {
    let clock = 1_000_000
    const office = harness({ now: () => clock })
    const priya = await office.enter('Priya')
    const alan = await office.enter('Alan')
    const carol = await office.enter('Carol')

    const asked = await office.engine.requestFollow(alan.socket, priya.id)
    const requestId = asked.ok ? asked.requestId : ''
    expect(await office.engine.declineFollow(priya.socket, requestId)).toEqual({ ok: true })

    expect(office.sent.last(alan.id, 'follow:resolved')).toEqual({
      requestId,
      outcome: 'declined',
    })
    expect(office.sent.to(carol.id, 'follow:resolved')).toHaveLength(0)

    const tooSoon = await office.engine.requestFollow(alan.socket, priya.id)
    expect(tooSoon).toMatchObject({ ok: false, code: Refusal.FOLLOW_COOLDOWN })

    clock += FOLLOW_DEFAULTS.declineCooldownMs - 1
    expect(await office.engine.requestFollow(alan.socket, priya.id)).toMatchObject({
      code: Refusal.FOLLOW_COOLDOWN,
    })
    clock += 1
    expect(await office.engine.requestFollow(alan.socket, priya.id)).toMatchObject({ ok: true })
  })

  it('cannot be chained, in either direction', async () => {
    const { office, priya, alan } = await following()
    const carol = await office.enter('Carol')

    // Nobody can follow a follower.
    expect(await office.engine.requestFollow(carol.socket, alan.id)).toMatchObject({
      ok: false,
      code: Refusal.FOLLOW_CHAIN,
    })
    // And somebody being followed cannot follow.
    expect(await office.engine.requestFollow(priya.socket, carol.id)).toMatchObject({
      ok: false,
      code: Refusal.FOLLOW_CHAIN,
    })
    // And a follower cannot start a second follow.
    expect(await office.engine.requestFollow(alan.socket, carol.id)).toMatchObject({
      ok: false,
      code: Refusal.FOLLOW_ALREADY,
    })
  })

  it('holds at most five followers by default, and the number is configuration', async () => {
    expect(FOLLOW_DEFAULTS.maxFollowers).toBe(5)

    const office = harness({ follow: { maxFollowers: 1 } })
    const priya = await office.enter('Priya')
    const alan = await office.enter('Alan')
    const carol = await office.enter('Carol')
    const asked = await office.engine.requestFollow(alan.socket, priya.id)
    await office.engine.acceptFollow(priya.socket, asked.ok ? asked.requestId : '')

    expect(await office.engine.requestFollow(carol.socket, priya.id)).toMatchObject({
      ok: false,
      code: Refusal.FOLLOW_FULL,
    })
  })

  it('checks again on accepting, since the last place may have gone meanwhile', async () => {
    const office = harness({ follow: { maxFollowers: 1 } })
    const priya = await office.enter('Priya')
    const alan = await office.enter('Alan')
    const carol = await office.enter('Carol')
    const fromAlan = await office.engine.requestFollow(alan.socket, priya.id)
    const fromCarol = await office.engine.requestFollow(carol.socket, priya.id)
    await office.engine.acceptFollow(priya.socket, fromAlan.ok ? fromAlan.requestId : '')

    const second = await office.engine.acceptFollow(
      priya.socket,
      fromCarol.ok ? fromCarol.requestId : '',
    )

    expect(second).toMatchObject({ ok: false, code: Refusal.FOLLOW_FULL })
    expect(office.sent.last(carol.id, 'follow:resolved')).toMatchObject({ outcome: 'cancelled' })
  })

  it('cannot ask somebody on do not disturb', async () => {
    const office = harness()
    const priya = await office.enter('Priya')
    const alan = await office.enter('Alan')
    await office.engine.setManualStatus(priya.socket, 'dnd')

    expect(await office.engine.requestFollow(alan.socket, priya.id)).toMatchObject({
      ok: false,
      code: Refusal.FOLLOW_DND,
    })
    expect(office.sent.to(priya.id, 'follow:requested')).toHaveLength(0)
  })

  it('refuses yourself, and asks the host about the pair', async () => {
    const asked: PermissionQuestion[] = []
    const host = typedEmailIdentity()
    const office = harness({
      identity: {
        authenticate: (credentials, context) => host.authenticate(credentials, context),
        async may(question) {
          asked.push(question)
          return question.permission === 'follow'
            ? refuse('guest.not_shared', 'You have not shared a room with them.')
            : allow()
        },
      },
    })
    const priya = await office.enter('Priya')
    const alan = await office.enter('Alan')

    expect(await office.engine.requestFollow(alan.socket, alan.id)).toMatchObject({
      code: Refusal.FOLLOW_SELF,
    })
    expect(await office.engine.requestFollow(alan.socket, priya.id)).toMatchObject({
      code: 'guest.not_shared',
    })
    expect(asked.find((one) => one.permission === 'follow')).toMatchObject({
      targetUserId: priya.id,
    })
  })

  it('starts without asking when the host remembers an allowance for the pair', async () => {
    const host = typedEmailIdentity()
    const office = harness({
      identity: {
        ...host,
        authenticate: (credentials, context) => host.authenticate(credentials, context),
        may: async () => allow(),
        async followsWithoutAsking(question) {
          return question.follower.displayName === 'Alan'
        },
      },
    })
    const priya = await office.enter('Priya')
    const alan = await office.enter('Alan')
    const carol = await office.enter('Carol')

    expect(await office.engine.requestFollow(alan.socket, priya.id)).toMatchObject({
      ok: true,
      following: true,
    })
    expect(office.sent.to(priya.id, 'follow:requested')).toHaveLength(0)
    expect(await office.engine.requestFollow(carol.socket, priya.id)).toMatchObject({
      ok: true,
      following: false,
    })
  })

  it('lets a request lapse, and tells both sides', async () => {
    const office = harness({ follow: { requestTtlMs: 20 } })
    const priya = await office.enter('Priya')
    const alan = await office.enter('Alan')
    const asked = await office.engine.requestFollow(alan.socket, priya.id)
    const requestId = asked.ok ? asked.requestId : ''

    await sleep(40)

    expect(office.sent.last(alan.id, 'follow:resolved')).toEqual({ requestId, outcome: 'expired' })
    expect(office.sent.last(priya.id, 'follow:resolved')).toEqual({ requestId, outcome: 'expired' })
    expect(await office.engine.acceptFollow(priya.socket, requestId)).toMatchObject({
      code: Refusal.FOLLOW_UNKNOWN,
    })
  })

  it('does not move a follower out of a call; the move waits for the call to end', async () => {
    const { office, priya, alan } = await following()
    await office.engine.joinRoom(priya.socket, office.room('Studio'))
    await office.engine.joinCall(alan.socket, { audio: true, video: false })

    await office.engine.joinRoom(priya.socket, office.room('Library'))

    expect(await office.roomOf(alan.id)).toBe(office.room('Studio'))
    expect(office.sent.last(alan.id, 'follow:held')).toMatchObject({
      code: Refusal.FOLLOW_WAITING_FOR_CALL,
    })
    expect(office.sent.last<FollowState>(alan.id, 'follow:state')?.following).toMatchObject({
      waitingFor: { roomId: office.room('Library') },
    })

    await office.engine.leaveCall(alan.socket)

    expect(await office.roomOf(alan.id)).toBe(office.room('Library'))
    expect(office.sent.last<FollowState>(alan.id, 'follow:state')?.following).not.toHaveProperty(
      'waitingFor',
    )
  })

  it('stops the follow, with a reason, when the call goes on too long', async () => {
    const { office, priya, alan } = await following({ follow: { callWaitMs: 20 } })
    await office.engine.joinRoom(priya.socket, office.room('Studio'))
    await office.engine.joinCall(alan.socket, { audio: true, video: false })
    await office.engine.joinRoom(priya.socket, office.room('Library'))

    await sleep(40)

    expect(office.sent.last(alan.id, 'follow:ended')).toMatchObject({ reason: 'call' })
    expect(await office.roomOf(alan.id)).toBe(office.room('Studio'))
  })

  it('ends every follow of somebody who leaves the office, and theirs', async () => {
    const { office, priya, alan } = await following()

    await office.engine.leaveOffice(priya.socket)

    expect(office.sent.last(alan.id, 'follow:ended')).toMatchObject({ reason: 'left' })
    expect(office.sent.last<FollowState>(alan.id, 'follow:state')?.following).toBeNull()

    const again = await following()
    await again.office.engine.leaveOffice(again.alan.socket)
    expect(again.office.sent.last(again.priya.id, 'follow:ended')).toMatchObject({
      reason: 'left',
    })
  })

  it('is part of your own snapshot, and nobody else sees it', async () => {
    const { office, priya, alan } = await following()
    const carol = await office.enter('Carol')

    const mine = await office.engine.resync(priya.socket)
    const theirs = await office.engine.resync(carol.socket)

    expect(mine.ok && mine.snapshot.you.follow?.followers).toMatchObject([{ userId: alan.id }])
    expect(theirs.ok && theirs.snapshot.you.follow).toEqual({
      following: null,
      followers: [],
      asking: null,
    })
    // Nothing about following is on anybody's public presence.
    await office.engine.flush()
    const people = office.sent.office.flatMap(
      (one) => (one.payload as { changes?: OfficeChange[] }).changes ?? [],
    )
    expect(JSON.stringify(people)).not.toMatch(/follow/i)
  })

  it('works across two nodes: asked on one, answered and moved on the other', async () => {
    const store = new MemoryPresenceStore()
    const events = localEventBus()
    const template = layout()
    const one = harness({ store, events, template })
    const two = harness({ store, events, template })
    const priya = await one.enter('Priya', 'one')
    const alan = await two.enter('Alan', 'two')

    const asked = await two.engine.requestFollow(alan.socket, priya.id)
    expect(await one.engine.acceptFollow(priya.socket, asked.ok ? asked.requestId : '')).toEqual({
      ok: true,
    })

    await one.engine.joinRoom(priya.socket, one.room('Studio'))
    expect(await one.roomOf(alan.id)).toBe(one.room('Studio'))

    // And the follower's own move, on their node, still ends it.
    await two.engine.joinRoom(alan.socket, two.room('Library'))
    await one.engine.joinRoom(priya.socket, one.room('Workspace'))
    expect(await one.roomOf(alan.id)).toBe(one.room('Library'))
  })
})
