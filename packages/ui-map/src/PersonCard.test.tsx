import type { PublicPresence } from '@unityevolv/ofiskit-realtime-client'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HostAction } from './HostActions.js'
import { PersonAvatar } from './PersonAvatar.js'
import { HOVER_CLOSE_MS, HOVER_OPEN_MS, LONG_PRESS_MS } from './PersonCard.js'

/**
 * The card on a person, from the outside.
 *
 * Through `PersonAvatar`, because that is the only way it is ever drawn: an
 * avatar with the host's actions has a card, one without has none. What matters
 * is when it appears and goes — a moment after the pointer rests, at once on
 * keyboard focus, on a tap — and that a screen reader finds a named dialog with
 * the person's status and the host's buttons in it.
 */

function person(overrides: Partial<PublicPresence> = {}): PublicPresence {
  return {
    userId: 'grace',
    displayName: 'Grace Hopper',
    roomId: 'studio',
    devices: [
      {
        deviceId: 'grace-laptop',
        kind: 'web',
        inCall: false,
        muted: true,
        cameraOn: false,
        sharing: false,
        speaking: false,
        lastSpokeAt: null,
        handRaisedAt: null,
      },
    ],
    status: 'available',
    arrivedAt: '2026-01-01T09:00:00.000Z',
    ...overrides,
  }
}

function actions(overrides: Partial<HostAction>[] = []): HostAction[] {
  const base: HostAction[] = [
    { id: 'message', label: 'Message', onSelect: vi.fn() },
    { id: 'pin', label: 'Pin', onSelect: vi.fn() },
  ]
  return base.map((one, index) => ({ ...one, ...overrides[index] }))
}

function draw(options: { person?: PublicPresence; actions?: HostAction[]; onClick?(): void } = {}) {
  render(
    <>
      <PersonAvatar
        person={options.person ?? person()}
        size={56}
        actions={options.actions ?? actions()}
        {...(options.onClick ? { onClick: options.onClick } : {})}
      />
      <button type="button">After</button>
    </>,
  )
  return { avatar: screen.getByRole('button', { name: /^Grace Hopper,/ }) }
}

const card = () => screen.queryByRole('dialog', { name: 'Grace Hopper' })

describe('opening the card with a pointer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  // Fired by hand rather than through user-event, which waits on the same clock
  // the test is turning: every delay here is the card's own.
  const mouse = { pointerType: 'mouse' }
  const enter = (node: HTMLElement) => fireEvent.pointerEnter(node, mouse)
  const leave = (node: HTMLElement) => fireEvent.pointerLeave(node, mouse)
  const tap = (node: HTMLElement) => {
    fireEvent.pointerDown(node, { pointerType: 'touch', isPrimary: true, clientX: 5, clientY: 5 })
    fireEvent.pointerUp(node, { pointerType: 'touch' })
    fireEvent.click(node)
  }
  const tick = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms)
    })

  it('appears a moment after the pointer rests on the avatar, and not before', () => {
    const { avatar } = draw()

    enter(avatar)
    tick(HOVER_OPEN_MS - 1)
    expect(card()).toBeNull()

    tick(1)
    expect(card()).toBeInTheDocument()
    expect(avatar).toHaveAttribute('aria-expanded', 'true')
  })

  it('does not appear when the pointer leaves before the moment is up', () => {
    const { avatar } = draw()

    enter(avatar)
    tick(HOVER_OPEN_MS / 2)
    leave(avatar)
    tick(HOVER_OPEN_MS)

    expect(card()).toBeNull()
  })

  it('goes a moment after the pointer has left both the avatar and the card', () => {
    const { avatar } = draw()
    enter(avatar)
    tick(HOVER_OPEN_MS)

    // Over to the card: it stays.
    leave(avatar)
    enter(screen.getByTestId('person-card'))
    tick(HOVER_CLOSE_MS * 2)
    expect(card()).toBeInTheDocument()

    // And off it: it goes, after the grace.
    leave(screen.getByTestId('person-card'))
    tick(HOVER_CLOSE_MS - 1)
    expect(card()).toBeInTheDocument()
    tick(1)
    expect(card()).toBeNull()
    expect(avatar).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens on a tap when the host left the click to the engine', () => {
    const { avatar } = draw()

    tap(avatar)
    expect(card()).toBeInTheDocument()

    // A finger has no hover to leave, so a second tap is how it closes.
    tap(avatar)
    expect(card()).toBeNull()
  })

  it('leaves the tap to the host, and opens on a long press instead', () => {
    const onClick = vi.fn()
    const { avatar } = draw({ onClick })

    tap(avatar)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(card()).toBeNull()

    fireEvent.pointerDown(avatar, { pointerType: 'touch', isPrimary: true, clientX: 5, clientY: 5 })
    tick(LONG_PRESS_MS)
    expect(card()).toBeInTheDocument()
    // The press is not also a tap.
    fireEvent.pointerUp(avatar, { pointerType: 'touch' })
    fireEvent.click(avatar)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('leaves the browser’s own context menu alone', () => {
    const { avatar } = draw()
    expect(fireEvent.contextMenu(avatar)).toBe(true)
    expect(card()).toBeNull()
  })
})

describe('opening the card from the keyboard', () => {
  it('appears on focus, says it has a dialog, and Tab walks into its buttons', async () => {
    const user = userEvent.setup()
    const { avatar } = draw()
    expect(avatar).toHaveAttribute('aria-haspopup', 'dialog')

    await user.tab()
    expect(avatar).toHaveFocus()
    expect(card()).toBeInTheDocument()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Message' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Pin' })).toHaveFocus()

    // Shift+Tab from the first goes back to the avatar.
    await user.tab({ shift: true })
    await user.tab({ shift: true })
    expect(avatar).toHaveFocus()
    expect(card()).toBeInTheDocument()
  })

  it('closes on Escape and gives focus back to the avatar, without opening again', async () => {
    const user = userEvent.setup()
    const { avatar } = draw()

    await user.tab()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Message' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(card()).toBeNull()
    expect(avatar).toHaveFocus()

    // Gone until focus leaves and comes back.
    await user.tab({ shift: true })
    await user.tab()
    expect(card()).toBeInTheDocument()
  })

  it('leaves the card past its last button and carries on from the avatar', async () => {
    const user = userEvent.setup()
    draw()

    await user.tab()
    await user.tab()
    await user.tab()
    await user.tab()

    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus()
    expect(card()).toBeNull()
  })
})

describe('what the card says', () => {
  it('shows the face, the name and the status as the map draws it', async () => {
    const user = userEvent.setup()
    draw({
      person: person({
        status: 'dnd',
        custom: { text: 'Heads down until 3', emoji: '🎧' },
        photoUrl: 'https://example.test/grace.png',
      }),
    })

    await user.tab()

    const dialog = card()!
    expect(within(dialog).getByText('Grace Hopper')).toBeInTheDocument()
    expect(within(dialog).getByText('Do not disturb — 🎧 Heads down until 3')).toBeInTheDocument()
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe('https://example.test/grace.png')
  })

  it('falls back to initials, and says when they are in a call or sharing', async () => {
    const user = userEvent.setup()
    const device = person().devices[0]!
    draw({
      person: person({
        status: 'in_call',
        devices: [{ ...device, inCall: true, muted: false, sharing: true }],
      }),
    })

    await user.tab()

    const dialog = card()!
    expect(within(dialog).getByText('GH')).toBeInTheDocument()
    expect(within(dialog).getByText('In a call')).toBeInTheDocument()
    expect(within(dialog).getByText('In a call, Sharing their screen')).toBeInTheDocument()
  })

  it('runs an action from its button and closes', async () => {
    const user = userEvent.setup()
    const list = actions()
    draw({ actions: list })

    await user.tab()
    await user.click(screen.getByRole('button', { name: 'Pin' }))

    expect(list[1]!.onSelect).toHaveBeenCalledTimes(1)
    expect(list[0]!.onSelect).not.toHaveBeenCalled()
    expect(card()).toBeNull()
  })

  it('keeps a disabled action visible, with its reason as its hint and description', async () => {
    const user = userEvent.setup()
    const list = actions([{}, { disabled: 'Grace is in a call.' }])
    draw({ actions: list })

    await user.tab()

    const pin = screen.getByRole('button', { name: 'Pin' })
    expect(pin).toBeDisabled()
    expect(pin).toHaveAccessibleDescription('Grace is in a call.')
    expect(within(card()!).getByText('Grace is in a call.')).toBeVisible()
  })

  it('draws no card, and no dialog button, for an avatar without actions', () => {
    render(<PersonAvatar person={person()} size={56} actions={[]} />)
    expect(screen.getByRole('img', { name: /^Grace Hopper,/ })).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('keeps one card open at a time', async () => {
    const user = userEvent.setup()
    render(
      <>
        <PersonAvatar person={person()} size={56} actions={actions()} />
        <PersonAvatar
          person={person({ userId: 'ada', displayName: 'Ada Lovelace' })}
          size={56}
          actions={actions()}
        />
      </>,
    )

    await user.tab()
    expect(screen.getByRole('dialog', { name: 'Grace Hopper' })).toBeInTheDocument()

    await user.tab()
    await user.tab()
    await user.tab()
    expect(screen.getByRole('dialog', { name: 'Ada Lovelace' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Grace Hopper' })).toBeNull()
  })
})
