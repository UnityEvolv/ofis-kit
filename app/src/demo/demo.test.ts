// @vitest-environment node
//
// Node rather than jsdom: nothing here touches a DOM, and jsdom's event classes
// cannot carry Node's BroadcastChannel messages. This is the same channel every
// browser has, so the tabs below are as real as tabs in one process get.

import { createOfisClient, type OfisClient } from '@unityevolv/ofiskit-realtime-client'
import { createTemplate, type Template } from '@unityevolv/ofiskit-template'
import { afterEach, describe, expect, it } from 'vitest'

import { startColleagues } from './colleagues.js'
import { startDemoHost, type DemoHost } from './host.js'
import { channelSocket } from './socket.js'

/**
 * The office in the browser: the real engine in one "tab", clients in others,
 * talking over a BroadcastChannel.
 *
 * What is worth proving is that the channel is a faithful stand-in for the
 * server — people see each other, the engine's rules still hold and its refusals
 * still arrive — and that the office survives the tab running it going away.
 */

let serial = 0
const running: Array<{ close(): unknown }> = []

afterEach(async () => {
  for (const one of running.splice(0).reverse()) await one.close()
})

function office() {
  const channel = `test-demo-${++serial}`
  const template: Template = createTemplate({
    name: 'Test office',
    canvas: 'landscape',
    images: { light: 'office.svg' },
  })
  const host = (): DemoHost => {
    const started = startDemoHost({ channel, officeId: 'demo', template })
    running.push(started)
    return started
  }
  const tab = (deviceId: string): OfisClient => {
    const client = createOfisClient({
      url: 'demo',
      deviceId,
      connect: () => channelSocket({ channel, deviceId }),
    })
    running.push(client)
    return client
  }
  const room = (type: 'reception' | 'break' | 'workspace') =>
    template.rooms.find((one) => one.type === type)!.id
  return { channel, template, host, tab, room }
}

/**
 * Wait until something is true, as seen by this client.
 *
 * Checked on every change to the office and on every event, because some of what
 * a test waits for — a knock — is an event and changes nothing in the state.
 */
function until(client: OfisClient, test: (client: OfisClient) => boolean, ms = 3_000) {
  return new Promise<void>((resolve, reject) => {
    if (test(client)) return resolve()
    const check = () => {
      if (!test(client)) return
      done()
      resolve()
    }
    const unsubscribe = client.subscribe(check)
    const unlisten = client.on(check)
    const timer = setTimeout(() => {
      done()
      reject(new Error('the office never got there'))
    }, ms)
    function done() {
      clearTimeout(timer)
      unsubscribe()
      unlisten()
    }
  })
}

const names = (client: OfisClient) =>
  [...client.state().people.values()].map((person) => person.displayName).sort()

describe('the office in a tab', () => {
  it('lets two tabs walk in and see each other', async () => {
    const { host, tab } = office()
    host()
    const ada = tab('ada-tab')
    const grace = tab('grace-tab')

    expect(await ada.enter({ email: 'ada@example.com', name: 'Ada' })).toMatchObject({ ok: true })
    expect(await grace.enter({ email: 'grace@example.com', name: 'Grace' })).toMatchObject({
      ok: true,
    })

    await until(ada, (one) => names(one).includes('Grace'))
    expect(names(grace)).toEqual(['Ada', 'Grace'])
  })

  it('carries the engine’s refusals back, as the server would', async () => {
    const { host, tab } = office()
    host()
    const ada = tab('ada-tab')

    expect(await ada.enter({ email: 'not an email', name: 'Ada' })).toMatchObject({
      ok: false,
      code: 'identity.email_invalid',
    })
  })

  it('holds the rules: a locked room refuses, and a knock lets you in', async () => {
    const { host, tab, room } = office()
    host()
    const ada = tab('ada-tab')
    const grace = tab('grace-tab')
    await ada.enter({ email: 'ada@example.com', name: 'Ada' })
    await grace.enter({ email: 'grace@example.com', name: 'Grace' })

    const studio = room('workspace')
    expect(await ada.joinRoom(studio)).toMatchObject({ ok: true })
    expect(await ada.lock(studio)).toMatchObject({ ok: true })
    await until(grace, (one) => one.state().locks.has(studio))

    expect(await grace.joinRoom(studio)).toMatchObject({ ok: false })

    const knocks: string[] = []
    ada.on((event) => {
      if (event.type === 'knock') knocks.push(event.knockId)
    })
    expect(await grace.knock(studio)).toMatchObject({ ok: true })
    await until(ada, () => knocks.length > 0)

    expect(await ada.admit(knocks[0]!)).toMatchObject({ ok: true })
    expect(await grace.joinRoom(studio)).toMatchObject({ ok: true })
  })

  it('carries on when the tab running it closes, as after a server restart', async () => {
    const { host, tab } = office()
    const first = host()
    const grace = tab('grace-tab')
    await grace.enter({ email: 'grace@example.com', name: 'Grace' })
    await until(grace, (one) => names(one).includes('Grace'))

    // The host tab goes, and the next tab in line starts the office again.
    await first.close()
    host()

    // The client notices the new host, reconnects, and walks back in with what it
    // already has: seen from a newcomer, who can only know about Grace if she
    // re-entered the new office.
    const statuses: string[] = []
    grace.on((event) => {
      if (event.type === 'status') statuses.push(event.status)
    })
    const ada = tab('ada-tab')
    await ada.enter({ email: 'ada@example.com', name: 'Ada' })
    await until(ada, (one) => names(one).includes('Grace'))
    await until(grace, (one) => names(one).includes('Ada'))
    // Noticed as a lost connection, and back — the same as against a real server,
    // which also shows "connecting" while the client walks back in.
    expect(statuses[0]).toBe('reconnecting')
    expect(statuses.at(-1)).toBe('connected')
  })
})

describe('the simulated colleagues', () => {
  it('walk in, and say what they are', async () => {
    const { channel, template, host, tab } = office()
    host()
    const colleagues = startColleagues({ channel, template })
    running.push({ close: () => colleagues.stop() })
    const ada = tab('ada-tab')
    await ada.enter({ email: 'ada@example.com', name: 'Ada' })

    await until(ada, (one) => names(one).filter((name) => name.endsWith(' Bot')).length === 3)
  })

  it('knock on a room somebody locks', async () => {
    const { channel, template, host, tab, room } = office()
    host()
    const colleagues = startColleagues({ channel, template, timing: { knockAfterMs: 50 } })
    running.push({ close: () => colleagues.stop() })
    const ada = tab('ada-tab')
    await ada.enter({ email: 'ada@example.com', name: 'Ada' })
    await until(ada, (one) => names(one).filter((name) => name.endsWith(' Bot')).length === 3)

    const knocks: string[] = []
    ada.on((event) => {
      if (event.type === 'knock') knocks.push(event.displayName)
    })
    const studio = room('workspace')
    await ada.joinRoom(studio)
    await ada.lock(studio)

    await until(ada, () => knocks.length > 0)
    expect(knocks[0]).toMatch(/ Bot$/)
  })
})
