import type {
  ClientEvent,
  OfficeState,
  OfisClient,
  PublicPresence,
} from '@unityevolv/ofiskit-realtime-client'
import { fromSnapshot } from '@unityevolv/ofiskit-realtime-client'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createSounds } from './sounds.js'
import { useSounds } from './useSounds.js'

/**
 * When the office makes a sound, and — as much — when it stays quiet.
 *
 * The sounds themselves are made by the browser; what is tested here is the
 * deciding. A knock nobody hears is a knock that might as well not have happened,
 * and a chime every time anybody walks into reception is a sound people turn off.
 */

function person(
  userId: string,
  roomId: string,
  status: PublicPresence['status'] = 'available',
): PublicPresence {
  return {
    userId,
    displayName: userId,
    roomId,
    devices: [],
    status,
    arrivedAt: '2026-01-01T09:00:00.000Z',
  }
}

function office(people: PublicPresence[]): OfficeState {
  return fromSnapshot({
    officeId: 'office',
    seq: 1,
    people,
    locks: [],
    calls: [],
    you: { userId: 'ada', deviceId: 'ada-laptop', manual: null },
  })
}

function fakeClient() {
  const listeners = new Set<(event: ClientEvent) => void>()
  const client = {
    on(listener: (event: ClientEvent) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  } as unknown as OfisClient
  return {
    client,
    emit(event: ClientEvent) {
      for (const listener of [...listeners]) listener(event)
    },
  }
}

function listen(options: { state: OfficeState; enabled?: boolean }) {
  const sounds = { knock: vi.fn(), chime: vi.fn(), useSpeaker: vi.fn() }
  const { client, emit } = fakeClient()
  const hook = renderHook(
    ({ state }: { state: OfficeState }) =>
      useSounds(client, state, {
        enabled: options.enabled ?? true,
        quietRoomIds: ['reception'],
        sounds,
      }),
    { initialProps: { state: options.state } },
  )
  return { sounds, emit, rerender: (state: OfficeState) => hook.rerender({ state }) }
}

const knockEvent = (silent = false): ClientEvent => ({
  type: 'knock',
  knockId: 'k1',
  roomId: 'studio',
  userId: 'grace',
  displayName: 'Grace',
  silent,
})

describe('a knock at your door', () => {
  it('sounds like a knock', () => {
    const { sounds, emit } = listen({ state: office([person('ada', 'studio')]) })

    act(() => emit(knockEvent()))
    expect(sounds.knock).toHaveBeenCalledTimes(1)
  })

  it('stays quiet when the server says everybody inside is on do not disturb', () => {
    const { sounds, emit } = listen({ state: office([person('ada', 'studio')]) })

    act(() => emit(knockEvent(true)))
    expect(sounds.knock).not.toHaveBeenCalled()
  })

  it('stays quiet when you are on do not disturb yourself', () => {
    const { sounds, emit } = listen({ state: office([person('ada', 'studio', 'dnd')]) })

    act(() => emit(knockEvent()))
    expect(sounds.knock).not.toHaveBeenCalled()
  })

  it('stays quiet when sounds are turned off', () => {
    const { sounds, emit } = listen({ state: office([person('ada', 'studio')]), enabled: false })

    act(() => emit(knockEvent()))
    expect(sounds.knock).not.toHaveBeenCalled()
  })
})

describe('somebody arriving', () => {
  it('chimes when somebody walks into the room you are in', () => {
    const { sounds, rerender } = listen({ state: office([person('ada', 'studio')]) })

    rerender(office([person('ada', 'studio'), person('grace', 'studio')]))
    expect(sounds.chime).toHaveBeenCalledTimes(1)
  })

  it('stays quiet about arrivals in reception, where everybody arrives', () => {
    const { sounds, rerender } = listen({ state: office([person('ada', 'reception')]) })

    rerender(office([person('ada', 'reception'), person('grace', 'reception')]))
    expect(sounds.chime).not.toHaveBeenCalled()
  })

  it('stays quiet when it is you who moved', () => {
    // Everybody in the new room is new to you, and none of them arrived.
    const { sounds, rerender } = listen({
      state: office([person('ada', 'reception'), person('grace', 'studio')]),
    })

    rerender(office([person('ada', 'studio'), person('grace', 'studio')]))
    expect(sounds.chime).not.toHaveBeenCalled()
  })

  it('stays quiet about arrivals in some other room', () => {
    const { sounds, rerender } = listen({ state: office([person('ada', 'studio')]) })

    rerender(office([person('ada', 'studio'), person('grace', 'library')]))
    expect(sounds.chime).not.toHaveBeenCalled()
  })

  it('stays quiet when somebody leaves', () => {
    const { sounds, rerender } = listen({
      state: office([person('ada', 'studio'), person('grace', 'studio')]),
    })

    rerender(office([person('ada', 'studio')]))
    expect(sounds.chime).not.toHaveBeenCalled()
  })

  it('chimes when the room you knocked on lets you in', () => {
    const { sounds, emit } = listen({ state: office([person('ada', 'reception')]) })

    act(() => emit({ type: 'admitted', roomId: 'studio', byUserId: 'grace' }))
    expect(sounds.chime).toHaveBeenCalledTimes(1)
  })
})

describe('the sounds themselves', () => {
  const original = (globalThis as { AudioContext?: unknown }).AudioContext

  afterEach(() => {
    ;(globalThis as { AudioContext?: unknown }).AudioContext = original
  })

  it('does nothing, and throws nothing, in a browser without Web Audio', () => {
    ;(globalThis as { AudioContext?: unknown }).AudioContext = undefined
    const sounds = createSounds()

    expect(() => {
      sounds.knock()
      sounds.chime()
    }).not.toThrow()
  })

  it('makes nothing until the first sound is wanted', () => {
    // Browsers refuse to start audio before the page has been used, so the context
    // is created on demand rather than when the office opens.
    const made = vi.fn()
    ;(globalThis as { AudioContext?: unknown }).AudioContext = class {
      constructor() {
        made()
        throw new Error('no audio here')
      }
    }

    const sounds = createSounds()
    expect(made).not.toHaveBeenCalled()

    sounds.chime()
    expect(made).toHaveBeenCalledTimes(1)
  })
})
