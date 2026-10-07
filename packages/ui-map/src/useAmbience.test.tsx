import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { AmbiencePlayback, AmbiencePlayer } from './ambience.js'
import { useAmbience, type UseAmbienceOptions } from './useAmbience.js'

/**
 * When the loop plays — and, as much, when it does not.
 *
 * The person's switch is absolute, a call silences it, and a browser's autoplay
 * rule is met with an offer rather than a workaround.
 */

const cafe = { id: 'cafe', label: 'Café', src: '/ambience/cafe.mp3' }
const rain = { id: 'rain', label: 'Rain', src: '/ambience/rain.mp3' }

function fakePlayer(result: AmbiencePlayback = 'playing') {
  const player = {
    play: vi.fn(async (_src: string, _volume: number) => result),
    stop: vi.fn(),
    setVolume: vi.fn(),
    duck: vi.fn(),
    unlock: vi.fn(async () => true),
    useSpeaker: vi.fn(),
    close: vi.fn(),
  } satisfies AmbiencePlayer
  return player
}

function render(initial: Partial<UseAmbienceOptions>, player = fakePlayer()) {
  const base: UseAmbienceOptions = {
    track: cafe,
    enabled: true,
    volume: 0.4,
    suspended: false,
    player,
  }
  const hook = renderHook((props: UseAmbienceOptions) => useAmbience(props), {
    initialProps: { ...base, ...initial },
  })
  return {
    player,
    hook,
    update: (next: Partial<UseAmbienceOptions>) => hook.rerender({ ...base, ...initial, ...next }),
  }
}

describe('room ambience', () => {
  it('plays the room’s loop at the volume it is given', async () => {
    const { player, hook } = render({})
    await waitFor(() => expect(hook.result.current.status).toBe('playing'))
    expect(player.play).toHaveBeenCalledWith(cafe.src, 0.4)
  })

  it('is silent, with nothing to show, in a room without a loop', () => {
    const { player, hook } = render({ track: null })
    expect(hook.result.current.status).toBe('silent')
    expect(player.play).not.toHaveBeenCalled()
  })

  it('never plays for somebody who turned it off, but still says the room has one', () => {
    const { player, hook } = render({ enabled: false })
    expect(player.play).not.toHaveBeenCalled()
    expect(hook.result.current.status).toBe('off')
    expect(hook.result.current.track).toEqual(cafe)
  })

  it('stops when switched off and comes back when switched on', async () => {
    const { player, update } = render({})
    await waitFor(() => expect(player.play).toHaveBeenCalledTimes(1))
    update({ enabled: false })
    expect(player.stop).toHaveBeenCalled()
    update({ enabled: true })
    await waitFor(() => expect(player.play).toHaveBeenCalledTimes(2))
  })

  it('fades out for a call and back when it ends', async () => {
    const { player, hook, update } = render({})
    await waitFor(() => expect(player.play).toHaveBeenCalledTimes(1))
    update({ suspended: true })
    expect(player.stop).toHaveBeenCalled()
    expect(hook.result.current.status).toBe('paused')
    update({ suspended: false })
    await waitFor(() => expect(player.play).toHaveBeenCalledTimes(2))
  })

  it('changes loop with the room', async () => {
    const { player, update } = render({})
    update({ track: rain })
    await waitFor(() => expect(player.play).toHaveBeenLastCalledWith(rain.src, 0.4))
  })

  it('follows the volume without restarting the loop', async () => {
    const { player, update } = render({})
    await waitFor(() => expect(player.play).toHaveBeenCalledTimes(1))
    update({ volume: 0.8 })
    expect(player.setVolume).toHaveBeenLastCalledWith(0.8)
    expect(player.play).toHaveBeenCalledTimes(1)
  })

  it('offers to start when the browser wants a press, and plays after it', async () => {
    const player = fakePlayer('blocked')
    const { hook } = render({}, player)
    await waitFor(() => expect(hook.result.current.status).toBe('blocked'))

    player.play.mockResolvedValue('playing')
    await act(async () => hook.result.current.start())
    expect(player.unlock).toHaveBeenCalled()
    await waitFor(() => expect(hook.result.current.status).toBe('playing'))
  })

  it('says a loop that could not be loaded is unavailable', async () => {
    const { hook } = render({}, fakePlayer('failed'))
    await waitFor(() => expect(hook.result.current.status).toBe('unavailable'))
  })

  it('ducks through the player', () => {
    const { player, hook } = render({})
    hook.result.current.duck()
    expect(player.duck).toHaveBeenCalled()
  })

  it('lets the loop go with the component', () => {
    const { player, hook } = render({})
    hook.unmount()
    expect(player.close).toHaveBeenCalled()
  })
})
