import { describe, expect, it, vi } from 'vitest'

import { AMBIENCE_DUCK_LEVEL, ambienceGain, createAmbiencePlayer } from './ambience.js'

/**
 * The player, against a pretend Web Audio.
 *
 * What matters is the plumbing a person hears the result of: one fetch per loop
 * per session, a loop that loops, a fade rather than a cut, the browser's
 * autoplay rule reported rather than fought, and a duck under a knock.
 */

class FakeParam {
  value = 1
  events: Array<[string, number, number?]> = []
  setValueAtTime(value: number, at: number) {
    this.events.push(['set', value, at])
    this.value = value
  }
  linearRampToValueAtTime(value: number, at: number) {
    this.events.push(['ramp', value, at])
    this.value = value
  }
  setTargetAtTime(value: number, at: number) {
    this.events.push(['target', value, at])
    this.value = value
  }
  cancelScheduledValues() {}
}

function fakeContext(state: 'running' | 'suspended' = 'running') {
  const sources: Array<{
    buffer: unknown
    loop: boolean
    start: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
  }> = []
  const gains: Array<{ gain: FakeParam }> = []
  const node = () => ({ connect: (next: unknown) => next })
  const context = {
    state,
    currentTime: 0,
    destination: {},
    resume: vi.fn(() => {
      // A browser waiting for a gesture never settles this.
      if (context.allowed) {
        context.state = 'running'
        return Promise.resolve()
      }
      return new Promise<void>(() => {})
    }),
    allowed: state === 'running',
    close: vi.fn(() => Promise.resolve()),
    createGain() {
      const gain = { ...node(), gain: new FakeParam() }
      gains.push(gain)
      return gain
    },
    createBufferSource() {
      const source = { ...node(), buffer: null, loop: false, start: vi.fn(), stop: vi.fn() }
      sources.push(source)
      return source
    },
    decodeAudioData: vi.fn(async (bytes: ArrayBuffer) => ({ bytes })),
  }
  return { context, sources, gains }
}

function setup(state: 'running' | 'suspended' = 'running') {
  const fake = fakeContext(state)
  const fetch = vi.fn(async () => new Response(new ArrayBuffer(8)))
  const player = createAmbiencePlayer({
    fetch: fetch as unknown as typeof globalThis.fetch,
    context: () => fake.context as unknown as AudioContext,
  })
  return { ...fake, fetch, player }
}

describe('the ambience player', () => {
  it('plays a loop that loops, fading in from silence', async () => {
    const { player, sources, gains } = setup()
    expect(await player.play('/ambience/cafe.mp3', 0.5)).toBe('playing')
    expect(sources).toHaveLength(1)
    expect(sources[0]?.loop).toBe(true)
    expect(sources[0]?.start).toHaveBeenCalled()
    const fade = gains.at(-1)?.gain.events
    expect(fade?.[0]).toEqual(['set', 0, 0])
    expect(fade?.[1]?.[0]).toBe('ramp')
  })

  it('fetches each loop once per session', async () => {
    const { player, fetch } = setup()
    await player.play('/ambience/cafe.mp3', 0.5)
    await player.play('/ambience/rain.mp3', 0.5)
    await player.play('/ambience/cafe.mp3', 0.5)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('fades the old loop out rather than cutting it when the room changes', async () => {
    const { player, sources } = setup()
    await player.play('/ambience/cafe.mp3', 0.5)
    await player.play('/ambience/rain.mp3', 0.5)
    expect(sources[0]?.stop).toHaveBeenCalledWith(expect.any(Number))
    expect(sources[0]?.stop.mock.calls[0]?.[0]).toBeGreaterThan(0)
    expect(sources).toHaveLength(2)
  })

  it('does not start the same loop twice', async () => {
    const { player, sources } = setup()
    await player.play('/ambience/cafe.mp3', 0.5)
    await player.play('/ambience/cafe.mp3', 0.8)
    expect(sources).toHaveLength(1)
  })

  it('reports a browser waiting for a gesture as blocked, and plays once unlocked', async () => {
    const { player, context } = setup('suspended')
    expect(await player.play('/ambience/cafe.mp3', 0.5)).toBe('blocked')
    context.allowed = true
    expect(await player.unlock()).toBe(true)
    expect(await player.play('/ambience/cafe.mp3', 0.5)).toBe('playing')
  })

  it('reports a loop that cannot be fetched as failed', async () => {
    const fake = fakeContext()
    const player = createAmbiencePlayer({
      fetch: (async () => new Response('', { status: 404 })) as typeof fetch,
      context: () => fake.context as unknown as AudioContext,
    })
    expect(await player.play('/ambience/missing.mp3', 0.5)).toBe('failed')
  })

  it('dips under a notification and comes back', async () => {
    const { player, gains } = setup()
    await player.play('/ambience/cafe.mp3', 0.5)
    // The second gain made is the duck stage, between the loop and the volume.
    const duck = gains[1]?.gain
    player.duck()
    const values = duck?.events.map((event) => event[1])
    expect(values).toContain(AMBIENCE_DUCK_LEVEL)
    expect(values?.at(-1)).toBe(1)
  })

  it('stops with a fade, and does nothing when nothing plays', async () => {
    const { player, sources } = setup()
    player.stop()
    await player.play('/ambience/cafe.mp3', 0.5)
    player.stop()
    expect(sources[0]?.stop).toHaveBeenCalled()
  })
})

describe('ambience volume', () => {
  it('follows the square of the slider, clamped', () => {
    expect(ambienceGain(0)).toBe(0)
    expect(ambienceGain(0.5)).toBe(0.25)
    expect(ambienceGain(1)).toBe(1)
    expect(ambienceGain(2)).toBe(1)
    expect(ambienceGain(-1)).toBe(0)
    expect(ambienceGain(Number.NaN)).toBe(0)
  })
})
