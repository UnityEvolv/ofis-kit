import type { RoomCall } from '@unityevolv/ofiskit-realtime-client'
import { REACTIONS } from '@unityevolv/ofiskit-realtime-client'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { CallControls, type CallControlsProps } from './CallControls.js'

/**
 * The bar, from the outside.
 *
 * The rule most of these tests are about: **entering a room never joins its call.**
 * Which means every control is two different actions depending on whether you are
 * already in one, and the label has to say which — a button reading "Mute" while you
 * are not in the call is a button that lies.
 */

function call(overrides: Partial<RoomCall> = {}): RoomCall {
  return {
    roomId: 'studio',
    provider: 'builtin',
    startedAt: '2026-01-01T09:00:00.000Z',
    participants: [],
    limit: 4,
    ...overrides,
  }
}

function bar(props: Partial<CallControlsProps> = {}) {
  const handlers = {
    onToggleMic: vi.fn(),
    onToggleCamera: vi.fn(),
    onToggleShare: vi.fn(),
    onToggleHand: vi.fn(),
    onReact: vi.fn(),
    onToggleCallView: vi.fn(),
    onLeaveCall: vi.fn(),
    onOpenDevices: vi.fn(),
  }

  const view = render(
    <CallControls
      available
      inCall={false}
      muted
      cameraOn={false}
      sharing={false}
      handRaised={false}
      callView={false}
      call={null}
      {...handlers}
      {...props}
    />,
  )

  return { ...handlers, view, user: userEvent.setup() }
}

describe('the controls bar', () => {
  it('is a toolbar, so a screen reader announces it as one thing', () => {
    bar()
    expect(screen.getByRole('toolbar', { name: /office controls/i })).toBeInTheDocument()
  })

  it('keeps the bar but drops the call controls where there are no calls', () => {
    // Reception and the break room never have calls — but the bar is the only
    // chrome in this app, so the status control and the way out stay.
    bar({ available: false, leading: <span>You are in Reception</span> })

    expect(screen.getByRole('toolbar')).toBeInTheDocument()
    expect(screen.getByText('You are in Reception')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /microphone/i })).not.toBeInTheDocument()
  })

  it('offers to turn the microphone on when you are not in the call', async () => {
    const { user, onToggleMic } = bar({ inCall: false })

    // Not "Mute": you are not in the call, so there is nothing to mute.
    const mic = screen.getByRole('button', { name: 'Turn on microphone' })
    await user.click(mic)
    expect(onToggleMic).toHaveBeenCalled()
  })

  it('offers to mute once you are in it, and shows muted as a state worth noticing', () => {
    const { view } = bar({ inCall: true, muted: false })
    expect(screen.getByRole('button', { name: 'Mute microphone' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    view.unmount()

    // Talking while muted is the commonest thing that happens in any call product,
    // so it is not a quiet grey.
    bar({ inCall: true, muted: true })
    const muted = screen.getByRole('button', { name: 'Turn on microphone' })
    expect(muted.className).toMatch(/text-error/)
  })

  it('says what the camera button will do, not what is true now', () => {
    const { view } = bar({ cameraOn: false })
    expect(screen.getByRole('button', { name: 'Turn on camera' })).toBeInTheDocument()
    view.unmount()

    bar({ cameraOn: true })
    expect(screen.getByRole('button', { name: 'Turn off camera' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('offers to leave only while there is a call to leave', () => {
    const { view } = bar({ inCall: false })
    expect(screen.queryByRole('button', { name: /leave call/i })).not.toBeInTheDocument()
    view.unmount()

    bar({ inCall: true })
    expect(screen.getByRole('button', { name: /leave call/i })).toBeInTheDocument()
  })

  it('opens the device picker, and switches the call view', async () => {
    const { user, onOpenDevices, onToggleCallView } = bar()

    await user.click(screen.getByRole('button', { name: /microphone, camera and speaker/i }))
    expect(onOpenDevices).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /show the call full size/i }))
    expect(onToggleCallView).toHaveBeenCalled()
  })

  it('says the office map is what the toggle brings back', () => {
    bar({ callView: true })
    expect(screen.getByRole('button', { name: /show the office map/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('disables the call controls when the call is full, and says so beside them', () => {
    // Disabled and visible, never hidden, with the reason where a touch screen can
    // read it: a tooltip is invisible on one, and "why is this greyed out" is the
    // question this row exists to answer.
    bar({ call: call({ participants: [{ userId: 'a', deviceId: 'a' }], limit: 1 }) })

    expect(screen.getByRole('button', { name: /turn on microphone/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /turn on camera/i })).toBeDisabled()
    expect(screen.getByRole('note')).toHaveTextContent(/this call is full \(1 people\)/i)
  })

  it('never tells somebody already in the call that it is full', () => {
    bar({
      inCall: true,
      call: call({ participants: [{ userId: 'a', deviceId: 'a' }], limit: 1 }),
    })

    expect(screen.getByRole('button', { name: /mute microphone|turn on microphone/i })).toBeEnabled()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('shows a host’s own reason in place of working one out', async () => {
    // "You are a guest" is more useful than "it is full", and only the host's
    // identity adapter knows it.
    const { user, onToggleMic } = bar({ disabledReason: 'Guests cannot join calls.' })

    expect(screen.getByRole('note')).toHaveTextContent('Guests cannot join calls.')
    await user.click(screen.getByRole('button', { name: /turn on microphone/i }))
    expect(onToggleMic).not.toHaveBeenCalled()
  })

  it('has shortcuts for the two controls people press constantly', async () => {
    const { user, onToggleMic, onToggleCamera } = bar({ inCall: true, muted: false })

    await user.keyboard('m')
    await user.keyboard('V')

    expect(onToggleMic).toHaveBeenCalledTimes(1)
    expect(onToggleCamera).toHaveBeenCalledTimes(1)
  })

  it('does not mute somebody mid-sentence because they typed an m', async () => {
    const { user, onToggleMic } = bar({
      inCall: true,
      trailing: <input aria-label="Status" />,
    })

    await user.type(screen.getByRole('textbox', { name: 'Status' }), 'meeting')
    expect(onToggleMic).not.toHaveBeenCalled()
  })

  it('leaves browser shortcuts alone', async () => {
    const { user, onToggleMic } = bar({ inCall: true })
    await user.keyboard('{Control>}m{/Control}')
    expect(onToggleMic).not.toHaveBeenCalled()
  })

  it('has no shortcuts where there is no call to control', async () => {
    const { user, onToggleMic } = bar({ available: false })
    await user.keyboard('m')
    expect(onToggleMic).not.toHaveBeenCalled()
  })
})

/**
 * The two signals that need no media.
 *
 * Asking to speak and reacting are what somebody does *instead* of unmuting, which
 * is why they sit beside the microphone — and why they are only offered while in
 * the call, since neither reaches anybody who is not in the conversation.
 */
describe('raising a hand and reacting', () => {
  it('offers neither until you are in the call', () => {
    bar({ inCall: false })

    expect(screen.queryByRole('button', { name: /raise your hand/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^react$/i })).not.toBeInTheDocument()
  })

  it('raises a hand, and says whether pressing it puts one up or takes it down', async () => {
    // The label says what will happen rather than what is true now, like the
    // microphone: a control reading "Raise" while your hand is up is a control
    // that lies.
    const { user, onToggleHand } = bar({ inCall: true, muted: false })

    const raise = screen.getByRole('button', { name: 'Raise your hand' })
    expect(raise).toHaveAttribute('aria-pressed', 'false')
    await user.click(raise)
    expect(onToggleHand).toHaveBeenCalled()
  })

  it('shows a hand that is up as pressed, and offers to lower it', () => {
    bar({ inCall: true, muted: false, handRaised: true })

    const lower = screen.getByRole('button', { name: 'Lower your hand' })
    expect(lower).toHaveAttribute('aria-pressed', 'true')
  })

  it('opens the picker and sends exactly what was pressed', async () => {
    const { user, onReact } = bar({ inCall: true, muted: false })

    await user.click(screen.getByRole('button', { name: 'React' }))

    // Every one is a real button with a real name: an emoji on its own is not a
    // label, and "thumbs up" is.
    const applause = screen.getByRole('button', { name: /react with applause/i })
    await user.click(applause)

    expect(onReact).toHaveBeenCalledWith('👏')
  })

  it('offers the whole set and nothing else', async () => {
    // Closed on purpose, and the same list the server validates against.
    const { user } = bar({ inCall: true, muted: false })
    await user.click(screen.getByRole('button', { name: 'React' }))

    const picker = screen.getByTestId('reaction-picker')
    expect(within(picker).getAllByRole('button')).toHaveLength(REACTIONS.length)
  })
})
