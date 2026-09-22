import { createHash } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createTemplate } from '@unityevolv/ofiskit-template'
import { describe, expect, it } from 'vitest'

import { localEventBus, silentEventBus } from './events.js'
import { idForEmail, typedEmailIdentity } from './identity.js'
import { memoryRateLimiter, unlimited } from './rate-limit.js'
import { fileTemplateSource } from './template-file.js'
import { TemplateInvalid } from './template-source.js'

describe('the typed-email identity adapter', () => {
  const adapter = typedEmailIdentity()
  const context = { connectionId: 'c1', deviceId: 'd1', kind: 'web' as const }

  it('lets anyone in who types an email and a name', async () => {
    const identity = await adapter.authenticate({ email: 'ada@example.com', name: 'Ada' }, context)
    expect(identity).toMatchObject({ displayName: 'Ada' })
  })

  it('gives the same person the same id from a second tab', async () => {
    // The whole reason the id is derived rather than minted: without this, two
    // tabs are two people standing in the same room.
    const first = await adapter.authenticate({ email: 'ada@example.com', name: 'Ada' }, context)
    const second = await adapter.authenticate(
      { email: '  ADA@Example.com ', name: 'Ada on the laptop' },
      { ...context, connectionId: 'c2', deviceId: 'd2' },
    )
    expect('id' in first && 'id' in second && first.id === second.id).toBe(true)
  })

  it('mints a valid UUID, with the version and variant bits set', async () => {
    const id = await idForEmail('grace@example.com')
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('gives the same id it always has, now that it hashes with Web Crypto', async () => {
    // Moving off node:crypto must not change anybody's id: the digest is the
    // same SHA-256, laid out the same way.
    const digest = createHash('sha256').update('grace@example.com').digest('hex')
    const id = await idForEmail(' Grace@Example.com ')

    expect(id.replaceAll('-', '').slice(0, 12)).toBe(digest.slice(0, 12))
    expect(id.slice(-12)).toBe(digest.slice(20, 32))
  })

  it('refuses something that is not an email, and a blank name', async () => {
    const notEmail = await adapter.authenticate({ email: 'ada', name: 'Ada' }, context)
    expect(notEmail).toMatchObject({ authenticated: false, code: 'identity.email_invalid' })

    const noName = await adapter.authenticate({ email: 'ada@example.com', name: '  ' }, context)
    expect(noName).toMatchObject({ authenticated: false, code: 'identity.name_required' })
  })

  it('says yes to every permission, because there is nothing here to say no', async () => {
    const identity = await adapter.authenticate({ email: 'ada@example.com', name: 'Ada' }, context)
    if (!('id' in identity)) throw new Error('expected an identity')

    for (const permission of ['enter_office', 'join_room', 'lock_room', 'knock', 'invite', 'join_call'] as const) {
      const decision = await adapter.may({ permission, identity, officeId: 'office', roomId: 'r1' })
      expect(decision.allowed, permission).toBe(true)
    }
  })
})

describe('the file template source', () => {
  async function withTemplateFile(contents: string) {
    const dir = await mkdtemp(join(tmpdir(), 'ofiskit-'))
    const path = join(dir, 'template.json')
    await writeFile(path, contents)
    return path
  }

  it('reads and validates the file', async () => {
    const template = createTemplate({
      name: 'Hilltop',
      canvas: 'landscape',
      images: { light: 'hill.webp' },
    })
    const source = fileTemplateSource({ path: await withTemplateFile(JSON.stringify(template)) })
    expect(await source.get('office')).toEqual(template)
  })

  it('raises with every problem at once, so a typo is one pass not five restarts', async () => {
    const template = createTemplate({
      name: 'Broken',
      canvas: 'landscape',
      images: { light: 'x.webp' },
    })
    const broken = {
      ...template,
      rooms: template.rooms.filter((room) => room.type !== 'reception'),
      images: {},
    }
    const source = fileTemplateSource({ path: await withTemplateFile(JSON.stringify(broken)) })

    await expect(source.get('office')).rejects.toBeInstanceOf(TemplateInvalid)
    await source.get('office').catch((error: unknown) => {
      expect(error).toBeInstanceOf(TemplateInvalid)
      if (error instanceof TemplateInvalid) {
        expect(error.issues.length).toBeGreaterThan(1)
        expect(error.message).toContain('reception')
      }
    })
  })

  it('builds an image path without an origin in it', async () => {
    const template = createTemplate({
      name: 'Hilltop',
      canvas: 'square',
      images: { light: 'hill.webp' },
    })
    const source = fileTemplateSource({
      path: await withTemplateFile(JSON.stringify(template)),
      imageBase: '/office/',
    })
    // A path, so moving the product to another domain changes nothing here.
    expect(source.imageUrl('office', '/hill.webp')).toBe('/office/hill.webp')
  })
})

describe('the event bus', () => {
  it('is silent in the free office, and subscribing still works', () => {
    const bus = silentEventBus()
    let seen = 0
    const stop = bus.subscribe(() => (seen += 1))
    bus.publish({ type: 'access.revoked', userId: 'ada', reason: 'gone' })
    stop()
    expect(seen).toBe(0)
  })

  it('delivers to every subscriber, and a handler may unsubscribe itself', () => {
    const bus = localEventBus()
    const seen: string[] = []

    const stopFirst = bus.subscribe((event) => {
      seen.push(`first:${event.type}`)
      stopFirst()
    })
    bus.subscribe((event) => seen.push(`second:${event.type}`))

    bus.publish({ type: 'template.changed', officeId: 'office' })
    bus.publish({ type: 'template.changed', officeId: 'office' })

    expect(seen).toEqual([
      'first:template.changed',
      'second:template.changed',
      'second:template.changed',
    ])
  })
})

describe('the in-memory rate limiter', () => {
  /** A clock the test moves, so nothing has to wait for a window to pass. */
  function clock(at = 1_000_000) {
    return {
      now: () => at,
      advance(ms: number) {
        at += ms
      },
    }
  }

  it('allows up to the limit and then refuses', async () => {
    const limiter = memoryRateLimiter(() => 1_000)
    const outcomes: boolean[] = []
    for (let i = 0; i < 5; i += 1) {
      outcomes.push((await limiter.take('knock:ada:studio', 3, 60_000)).allowed)
    }
    expect(outcomes).toEqual([true, true, true, false, false])
  })

  it('counts down what is left, and says how long to wait', async () => {
    const time = clock()
    const limiter = memoryRateLimiter(time.now)

    expect(await limiter.take('k', 2, 60_000)).toMatchObject({ remaining: 1 })
    expect(await limiter.take('k', 2, 60_000)).toMatchObject({ remaining: 0 })

    time.advance(20_000)
    const refused = await limiter.take('k', 2, 60_000)
    // Not the whole window: what is left of it, so the refusal can say "try
    // again in forty seconds" rather than always saying a minute.
    expect(refused).toMatchObject({ allowed: false, remaining: 0, retryAfterMs: 40_000 })
  })

  it('starts again once the window has passed', async () => {
    const time = clock()
    const limiter = memoryRateLimiter(time.now)

    await limiter.take('k', 1, 60_000)
    expect((await limiter.take('k', 1, 60_000)).allowed).toBe(false)

    time.advance(60_001)
    expect((await limiter.take('k', 1, 60_000)).allowed).toBe(true)
  })

  it('keeps one budget per key, so two rooms do not share one', async () => {
    const limiter = memoryRateLimiter(() => 1_000)

    await limiter.take('knock:ada:studio', 1, 60_000)
    expect((await limiter.take('knock:ada:studio', 1, 60_000)).allowed).toBe(false)
    // A different door. The limit is about not making one room unusable, and has
    // nothing to say about knocking on another.
    expect((await limiter.take('knock:ada:library', 1, 60_000)).allowed).toBe(true)
  })

  it('always says yes when the host has decided the limit lives elsewhere', async () => {
    const limiter = unlimited()
    for (let i = 0; i < 50; i += 1) {
      expect((await limiter.take('k', 1, 60_000)).allowed).toBe(true)
    }
  })
})
