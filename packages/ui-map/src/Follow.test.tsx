import type {
  ClientEvent,
  FollowState,
  OfficeState,
  OfisClient,
} from '@unityevolv/ofiskit-realtime-client'
import { emptyOffice } from '@unityevolv/ofiskit-realtime-client'
import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { FollowRequestDock, FollowersControl, FollowingBar } from './Follow.js'
import { useFollow } from './useFollow.js'

/**
 * Following, as both people see it. Most of what matters is that the way out is
 * always on screen, and that being followed is never a secret.
 */

const names: Record<string, string> = { priya: 'Priya', alan: 'Alan', carol: 'Carol' }
const nameOf = (userId: string) => names[userId] ?? 'Somebody'
const roomName = (roomId: string) => (roomId === 'library' ? 'Library' : 'Studio')

const nobody: FollowState = { following: null, followers: [], asking: null }

describe('useFollow', () => {
  function fakeClient() {
    const listeners = new Set<(event: ClientEvent) => void>()
    const client = {
      on(listener: (event: ClientEvent) => void) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    } as unknown as OfisClient
    const fire = (event: ClientEvent) => act(() => listeners.forEach((listener) => listener(event)))
    return { client, fire }
  }

  const state = (follow?: FollowState): OfficeState => ({
    ...emptyOffice('office'),
    you: { userId: 'priya', deviceId: 'laptop', manual: null, ...(follow ? { follow } : {}) },
  })

  it('holds requests until they are answered anywhere', () => {
    const { client, fire } = fakeClient()
    const onRequest = vi.fn()
    const { result } = renderHook(() => useFollow(client, state(), { onRequest }))

    fire({
      type: 'follow.requested',
      requestId: 'r1',
      userId: 'alan',
      displayName: 'Alan',
      expiresAt: '2026-10-08T09:01:00.000Z',
    })
    expect(result.current.requests).toMatchObject([{ requestId: 'r1', displayName: 'Alan' }])
    expect(onRequest).toHaveBeenCalledTimes(1)

    fire({ type: 'follow.resolved', requestId: 'r1', outcome: 'expired' })
    expect(result.current.requests).toEqual([])
  })

  it('reads your side from the office state, and nobody before anything is known', () => {
    const { client } = fakeClient()
    expect(renderHook(() => useFollow(client, state())).result.current.follow).toEqual(nobody)

    const followed = { ...nobody, followers: [{ userId: 'alan', since: 'x' }] }
    expect(renderHook(() => useFollow(client, state(followed))).result.current.follow).toEqual(
      followed,
    )
  })
})

describe('FollowRequestDock', () => {
  const request = { requestId: 'r1', userId: 'alan', displayName: 'Alan' }

  it('asks plainly, and answers either way', async () => {
    const user = userEvent.setup()
    const onAccept = vi.fn()
    const onDecline = vi.fn()
    render(<FollowRequestDock requests={[request]} onAccept={onAccept} onDecline={onDecline} />)

    expect(screen.getByRole('region', { name: /asking to follow you/i })).toHaveTextContent(
      /Alan would like to follow you/,
    )
    // No remembering unless the host offers it: the engine keeps nothing.
    expect(screen.queryByRole('checkbox')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Let them follow' }))
    expect(onAccept).toHaveBeenCalledWith('r1', false)
    await user.click(screen.getByRole('button', { name: 'Not now' }))
    expect(onDecline).toHaveBeenCalledWith('r1')
  })

  it('offers to remember the pair when the host can', async () => {
    const user = userEvent.setup()
    const onAccept = vi.fn()
    render(
      <FollowRequestDock
        requests={[request]}
        onAccept={onAccept}
        onDecline={() => {}}
        rememberLabel="Let Alan follow me without asking"
      />,
    )

    await user.click(screen.getByRole('checkbox', { name: /without asking/i }))
    await user.click(screen.getByRole('button', { name: 'Let them follow' }))
    expect(onAccept).toHaveBeenCalledWith('r1', true)
  })
})

describe('FollowingBar', () => {
  it('draws nothing when not following or asking', () => {
    const { container } = render(
      <FollowingBar follow={nobody} nameOf={nameOf} roomName={roomName} onStop={() => {}} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('says who you follow, with a stop always there', async () => {
    const user = userEvent.setup()
    const onStop = vi.fn()
    render(
      <FollowingBar
        follow={{ ...nobody, following: { userId: 'priya', since: 'x' } }}
        nameOf={nameOf}
        roomName={roomName}
        onStop={onStop}
      />,
    )

    expect(screen.getByTestId('following-bar')).toHaveTextContent('Following Priya')
    await user.click(screen.getByRole('button', { name: 'Stop following' }))
    expect(onStop).toHaveBeenCalled()
  })

  it('says where it will take you once your call ends', () => {
    render(
      <FollowingBar
        follow={{
          ...nobody,
          following: {
            userId: 'priya',
            since: 'x',
            waitingFor: { roomId: 'library', until: 'y' },
          },
        }}
        nameOf={nameOf}
        roomName={roomName}
        onStop={() => {}}
      />,
    )
    expect(screen.getByTestId('following-bar')).toHaveTextContent(
      /into Library when your call ends/,
    )
  })

  it('lets a request still waiting be withdrawn', () => {
    render(
      <FollowingBar
        follow={{ ...nobody, asking: { requestId: 'r1', userId: 'priya', expiresAt: 'x' } }}
        nameOf={nameOf}
        roomName={roomName}
        onStop={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument()
  })
})

describe('FollowersControl', () => {
  it('is not there when nobody follows you', () => {
    const { container } = render(
      <FollowersControl follow={nobody} nameOf={nameOf} onRemove={() => {}} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('says how many, lists them, and stops each', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    render(
      <FollowersControl
        follow={{
          ...nobody,
          followers: [
            { userId: 'alan', since: 'x' },
            { userId: 'carol', since: 'y' },
          ],
        }}
        nameOf={nameOf}
        onRemove={onRemove}
      />,
    )

    await user.click(screen.getByRole('button', { name: /2 people following you/ }))
    await user.click(screen.getByRole('button', { name: 'Stop Carol following you' }))
    expect(onRemove).toHaveBeenCalledWith('carol')
  })
})
