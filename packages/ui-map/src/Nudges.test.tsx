import type {
  ClientEvent,
  OfficeState,
  OfisClient,
  PublicPresence,
  Status,
} from '@unityevolv/ofiskit-realtime-client'
import { emptyOffice } from '@unityevolv/ofiskit-realtime-client'
import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HeldNudges, NudgeDialog, NudgeDock } from './Nudges.js'
import { useNudges, type IncomingNudge } from './useNudges.js'

/**
 * A tap on the shoulder: the notice, the quiet badge, and the line.
 *
 * The rule most worth testing is the call: a nudge never interrupts one, and is
 * shown once it is over.
 */

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

function office(status: Status): OfficeState {
  const me: PublicPresence = {
    userId: 'ada',
    displayName: 'Ada',
    roomId: 'studio',
    devices: [],
    status,
    arrivedAt: '2026-10-08T09:00:00.000Z',
  }
  return {
    ...emptyOffice('office'),
    people: new Map([['ada', me]]),
    you: { userId: 'ada', deviceId: 'laptop', manual: null },
    ready: true,
  }
}

const nudgeEvent = (
  overrides: Partial<Extract<ClientEvent, { type: 'nudge' }>> = {},
): ClientEvent => ({
  type: 'nudge',
  nudgeId: 'n1',
  userId: 'priya',
  displayName: 'Priya',
  roomId: 'library',
  delivery: 'now',
  at: '2026-10-08T09:00:00.000Z',
  ...overrides,
})

const nudge = (overrides: Partial<IncomingNudge> = {}): IncomingNudge => ({
  nudgeId: 'n1',
  userId: 'priya',
  displayName: 'Priya',
  roomId: 'library',
  at: '2026-10-08T09:00:00.000Z',
  ...overrides,
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useNudges', () => {
  it('shows a nudge to somebody available, and says so to the host', () => {
    const { client, fire } = fakeClient()
    const onShow = vi.fn()
    const { result } = renderHook(() => useNudges(client, office('available'), { onShow }))

    fire(nudgeEvent({ line: 'got a minute?' }))

    expect(result.current.shown).toMatchObject([{ userId: 'priya', line: 'got a minute?' }])
    expect(onShow).toHaveBeenCalledTimes(1)
  })

  it('keeps one per person: a second nudge replaces the first', () => {
    const { client, fire } = fakeClient()
    const { result } = renderHook(() => useNudges(client, office('available')))

    fire(nudgeEvent())
    fire(nudgeEvent({ nudgeId: 'n2' }))

    expect(result.current.shown.map((one) => one.nudgeId)).toEqual(['n2'])
  })

  it('holds a nudge during a call, and shows it once when the call ends', () => {
    const { client, fire } = fakeClient()
    const onShow = vi.fn()
    const onHold = vi.fn()
    const { result, rerender } = renderHook(
      ({ status }: { status: Status }) => useNudges(client, office(status), { onShow, onHold }),
      { initialProps: { status: 'in_call' as Status } },
    )

    fire(nudgeEvent({ delivery: 'held' }))
    expect(result.current.held).toHaveLength(1)
    expect(result.current.shown).toHaveLength(0)
    expect(onHold).toHaveBeenCalledTimes(1)
    expect(onShow).not.toHaveBeenCalled()

    rerender({ status: 'available' })
    expect(result.current.held).toHaveLength(0)
    expect(result.current.shown).toHaveLength(1)
    expect(onShow).toHaveBeenCalledTimes(1)

    // Shown once: another call and its end do not bring it back a second time.
    act(() => result.current.dismiss('n1'))
    rerender({ status: 'in_call' })
    rerender({ status: 'available' })
    expect(result.current.shown).toHaveLength(0)
    expect(onShow).toHaveBeenCalledTimes(1)
  })

  it('holds even a nudge sent as "now" if this screen already knows it is in a call', () => {
    const { client, fire } = fakeClient()
    const { result } = renderHook(() => useNudges(client, office('in_call')))

    fire(nudgeEvent({ delivery: 'now' }))

    expect(result.current.held).toHaveLength(1)
  })
})

describe('NudgeDock', () => {
  const dock = (overrides: Partial<Parameters<typeof NudgeDock>[0]> = {}) => (
    <NudgeDock
      nudges={[nudge({ line: 'got a minute?' })]}
      roomName={(roomId) => (roomId === 'library' ? 'Library' : 'Studio')}
      yourRoomId="studio"
      onJoin={() => {}}
      onDismiss={() => {}}
      {...overrides}
    />
  )

  it('draws nothing for no nudges', () => {
    const { container } = render(dock({ nudges: [] }))
    expect(container).toBeEmptyDOMElement()
  })

  it('says who, where they are and their line, as a landmark', () => {
    render(dock())
    expect(screen.getByRole('region', { name: 'Nudges' })).toHaveTextContent(
      /Priya nudged you from Library.*got a minute\?/,
    )
  })

  it('joins them, takes the host’s own actions, and dismisses', async () => {
    const user = userEvent.setup()
    const onJoin = vi.fn()
    const onDismiss = vi.fn()
    const invite = vi.fn()
    render(
      dock({
        onJoin,
        onDismiss,
        actions: () => [{ id: 'invite', label: 'Invite them here', onSelect: invite }],
      }),
    )

    await user.click(screen.getByRole('button', { name: 'Join them' }))
    expect(onJoin).toHaveBeenCalledWith(expect.objectContaining({ nudgeId: 'n1' }))
    await user.click(screen.getByRole('button', { name: 'Invite them here' }))
    expect(invite).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledWith('n1')
  })

  it('disables joining, with the reason, when you are already together', () => {
    render(dock({ yourRoomId: 'library' }))
    const join = screen.getByRole('button', { name: 'Join them' })
    expect(join).toBeDisabled()
    expect(join).toHaveAccessibleDescription(/already in the same room/i)
  })

  it('goes by itself after a while, and not sooner because something re-rendered', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    const { rerender } = render(dock({ onDismiss, visibleMs: 1000 }))
    vi.advanceTimersByTime(600)
    rerender(dock({ onDismiss: (nudgeId) => onDismiss(nudgeId), visibleMs: 1000 }))
    vi.advanceTimersByTime(399)
    expect(onDismiss).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onDismiss).toHaveBeenCalledWith('n1')
  })
})

describe('HeldNudges', () => {
  it('is a count and nothing more, and nothing at all for none', () => {
    const { container, rerender } = render(<HeldNudges count={0} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<HeldNudges count={2} />)
    expect(screen.getByTestId('held-nudges')).toHaveTextContent('2 nudges after your call')
  })
})

describe('NudgeDialog', () => {
  it('sends the line folded to one, or nothing when nothing was typed', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<NudgeDialog open name="Priya" onSend={onSend} onClose={() => {}} />)

    await user.click(screen.getByRole('button', { name: 'Nudge' }))
    expect(onSend).toHaveBeenLastCalledWith(undefined)

    await user.type(screen.getByLabelText(/a line/i), 'got{enter}a   minute?')
    await user.click(screen.getByRole('button', { name: 'Nudge' }))
    expect(onSend).toHaveBeenLastCalledWith('got a minute?')
  })

  it('will not send more than a tweet', async () => {
    const user = userEvent.setup()
    render(<NudgeDialog open name="Priya" onSend={() => {}} onClose={() => {}} />)

    await user.click(screen.getByLabelText(/a line/i))
    await user.paste('x'.repeat(281))

    expect(screen.getByRole('button', { name: 'Nudge' })).toBeDisabled()
    expect(screen.getByText(/1 over the limit/)).toBeInTheDocument()
  })
})
