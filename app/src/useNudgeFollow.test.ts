import type {
  ClientEvent,
  FollowState,
  OfficeState,
  OfisClient,
  PublicPresence,
  Status,
} from '@unityevolv/ofiskit-realtime-client'
import { emptyOffice } from '@unityevolv/ofiskit-realtime-client'
import { createTemplate } from '@unityevolv/ofiskit-template'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useNudgeFollow } from './useNudgeFollow.js'

/** The card's actions and what they do, in this app. */

const template = createTemplate({
  name: 'Office',
  canvas: 'landscape',
  images: { light: 'o.webp' },
})

function person(userId: string, status: Status = 'available'): PublicPresence {
  return {
    userId,
    displayName: userId === 'priya' ? 'Priya' : 'Ada',
    roomId: template.rooms[0]?.id ?? '',
    devices: [],
    status,
    arrivedAt: '2026-10-08T09:00:00.000Z',
  }
}

function office(priya: Status, follow?: FollowState): OfficeState {
  return {
    ...emptyOffice('office'),
    people: new Map([
      ['ada', person('ada')],
      ['priya', person('priya', priya)],
    ]),
    you: { userId: 'ada', deviceId: 'laptop', manual: null, ...(follow ? { follow } : {}) },
    ready: true,
  }
}

function fakeClient() {
  return {
    on: (_listener: (event: ClientEvent) => void) => () => {},
    nudge: vi.fn(async () => ({ ok: true as const, nudgeId: 'n1', delivery: 'now' as const })),
    requestFollow: vi.fn(async () => ({ ok: true as const, requestId: 'r1', following: false })),
    stopFollowing: vi.fn(async () => ({ ok: true as const })),
    removeFollower: vi.fn(async () => ({ ok: true as const })),
  }
}

const nobody: FollowState = { following: null, followers: [], asking: null }

describe('the actions on a colleague', () => {
  it('offers nudge and ask to follow, and nothing on yourself', () => {
    const client = fakeClient()
    const { result } = renderHook(() =>
      useNudgeFollow(client as unknown as OfisClient, office('available'), template),
    )
    expect(result.current.actionsFor(person('priya')).map((one) => one.label)).toEqual([
      'Nudge',
      'Ask to follow',
    ])
    expect(result.current.actionsFor(person('ada'))).toEqual([])
  })

  it('disables both for do not disturb, with the reason', () => {
    const client = fakeClient()
    const { result } = renderHook(() =>
      useNudgeFollow(client as unknown as OfisClient, office('dnd'), template),
    )
    const actions = result.current.actionsFor(person('priya', 'dnd'))
    expect(actions.map((one) => one.disabled)).toEqual([
      'Priya is on do not disturb.',
      'Priya is on do not disturb.',
    ])
  })

  it('opens the composer, then sends the line to the right person', async () => {
    const client = fakeClient()
    const { result } = renderHook(() =>
      useNudgeFollow(client as unknown as OfisClient, office('available'), template),
    )
    act(() => result.current.actionsFor(person('priya'))[0]?.onSelect())
    expect(result.current.composing?.userId).toBe('priya')

    await act(async () => result.current.sendNudge('got a minute?'))
    expect(client.nudge).toHaveBeenCalledWith('priya', 'got a minute?')
    expect(result.current.composing).toBeNull()
  })

  it('turns into stop when you follow them, or they follow you', () => {
    const client = fakeClient()
    const following = renderHook(() =>
      useNudgeFollow(
        client as unknown as OfisClient,
        office('available', { ...nobody, following: { userId: 'priya', since: 'x' } }),
        template,
      ),
    )
    const stop = following.result.current.actionsFor(person('priya'))[1]
    expect(stop?.label).toBe('Stop following')
    stop?.onSelect()
    expect(client.stopFollowing).toHaveBeenCalled()

    const followed = renderHook(() =>
      useNudgeFollow(
        client as unknown as OfisClient,
        office('available', { ...nobody, followers: [{ userId: 'priya', since: 'x' }] }),
        template,
      ),
    )
    const cut = followed.result.current.actionsFor(person('priya'))[1]
    expect(cut?.label).toBe('Stop them following you')
    cut?.onSelect()
    expect(client.removeFollower).toHaveBeenCalledWith('priya')
  })
})
