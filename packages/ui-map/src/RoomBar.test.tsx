import { createTemplate, type Room } from '@unityevolv/ofiskit-template'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { RoomBar, type RoomBarProps } from './RoomBar.js'

/**
 * The bar on top of every room.
 *
 * One loud button and the rest quiet: Join is the thing most people come to a room
 * bar to do, and knocking, locking and unlocking are about the door rather than
 * about going through it. On a narrow room the bar has to fit all of it without
 * ever pushing Join off its own edge.
 */

const room = (): Room => {
  const template = createTemplate({
    name: 'Test',
    canvas: 'landscape',
    images: { light: 'o.webp' },
  })
  return template.rooms.find((one) => one.type === 'workspace')!
}

function roomBar(props: Partial<RoomBarProps> = {}) {
  const handlers = { onJoin: vi.fn(), onKnock: vi.fn(), onLock: vi.fn(), onUnlock: vi.fn() }
  const view = render(
    <RoomBar
      room={room()}
      occupancy={1}
      capacity={null}
      locked={false}
      inside={false}
      width={320}
      {...handlers}
      {...props}
    />,
  )
  return { ...handlers, unmount: view.unmount, user: userEvent.setup() }
}

describe('the room bar', () => {
  it('makes Join the one primary button, and a word rather than an icon', () => {
    roomBar()

    const join = screen.getByRole('button', { name: 'Join' })
    expect(join.className).toMatch(/btn-primary/)
    // The word is the whole of it: an icon beside it only took width.
    expect(join.querySelector('svg')).toBeNull()
  })

  it('makes knocking secondary', () => {
    roomBar({ locked: true })

    const knock = screen.getByRole('button', { name: 'Knock' })
    expect(knock.className).toMatch(/btn-secondary/)
  })

  it('makes locking and unlocking secondary', () => {
    roomBar({ inside: true })
    expect(screen.getByRole('button', { name: 'Lock' }).className).toMatch(/btn-secondary/)
  })

  it('offers to unlock a locked room from inside', async () => {
    const { user, onUnlock } = roomBar({ inside: true, locked: true })

    const unlock = screen.getByRole('button', { name: 'Unlock' })
    expect(unlock.className).toMatch(/btn-secondary/)
    await user.click(unlock)
    expect(onUnlock).toHaveBeenCalled()
  })

  it('offers no lock in a conference room, and says what the room is', () => {
    // The server refuses to lock one, so the bar does not offer it: a button that
    // is always refused is worse than no button.
    roomBar({ room: { ...room(), type: 'conference' }, inside: true })

    expect(screen.queryByRole('button', { name: 'Lock' })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: /conference room/i })).toBeInTheDocument()
  })
})

describe('a narrow room', () => {
  it('shrinks the door controls to icons, and keeps their names', () => {
    // The accessible name is all that is left of the word, so it had better be
    // there.
    roomBar({ inside: true, width: 120 })

    const lock = screen.getByRole('button', { name: 'Lock' })
    expect(lock).not.toHaveTextContent('Lock')
    expect(lock.querySelector('svg')).not.toBeNull()
  })

  it('keeps Join as a word, with less room around it', () => {
    roomBar({ width: 120 })

    const join = screen.getByRole('button', { name: 'Join' })
    expect(join).toHaveTextContent('Join')
    expect(join.className).toMatch(/px-1\b/)
  })

  it('drops the head count and the room-type icon to leave the name some space', () => {
    // Left in, they took the width the name needed: at a phone's map scale the
    // name was squeezed to nothing while Join ran off the bar's edge.
    roomBar({ width: 120, occupancy: 7 })

    const bar = screen.getByTestId(/^room-bar-/)
    expect(within(bar).queryByText('7')).not.toBeInTheDocument()
    expect(within(bar).getByText(room().name)).toBeInTheDocument()
  })

  it('shows the head count where there is room for it', () => {
    roomBar({ width: 320, occupancy: 7 })

    expect(within(screen.getByTestId(/^room-bar-/)).getByText('7')).toBeInTheDocument()
  })
})

/**
 * A narrow bar with a call running in its room.
 *
 * The badge that says "there is a conversation in here" is the thing most worth
 * showing on a room bar — except where showing it pushes the room's only action
 * off the bar's edge. On a phone's map a bar is 65 to 90 pixels wide, and the badge
 * beside a worded Join left no Join at all.
 */
describe('a narrow room with a call in it', () => {
  const call = (count: number) => ({
    roomId: room().id,
    provider: 'builtin',
    startedAt: '2026-01-01T09:00:00.000Z',
    participants: Array.from({ length: count }, (_, index) => ({
      userId: `u${index}`,
      deviceId: `u${index}-laptop`,
    })),
    limit: 4,
    sharing: null,
  })

  it('shows the whole badge where there is room for it', () => {
    roomBar({ width: 320, call: call(2) })

    const badge = screen.getByRole('img', { name: 'Call with 2 people' })
    expect(badge).toHaveTextContent('2/4')
  })

  it('keeps the microphone and drops the count on a narrow bar', () => {
    roomBar({ width: 150, call: call(2) })

    const badge = screen.getByRole('img', { name: 'Call with 2 people' })
    expect(badge).not.toHaveTextContent('2/4')
    expect(screen.getByRole('button', { name: 'Join' })).toHaveTextContent('Join')
  })

  it('drops the badge entirely on the tiniest, and keeps the action', () => {
    // The room's own accessible name still says there is a call in it; the bar's
    // job at this size is to be pressable.
    roomBar({ width: 80, call: call(2) })

    expect(screen.queryByRole('img', { name: /call with/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Join' })).toBeInTheDocument()
  })

  it('lets Knock say the room is locked, rather than a second lock icon', () => {
    roomBar({ width: 80, locked: true, call: call(2) })

    expect(screen.queryByRole('img', { name: /is locked/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Knock' })).toBeInTheDocument()
  })

  it('shows the lock where there is room for it', () => {
    roomBar({ width: 320, locked: true })

    expect(screen.getByRole('img', { name: /is locked/i })).toBeInTheDocument()
  })
})

/**
 * Which buttons are words and which are a padlock.
 *
 * Join and Knock are what somebody outside a room came to its bar to do, so they
 * are words at every width. Lock and Unlock are a padlock at every width, with the
 * word as the name a screen reader reads.
 */
describe('words and padlocks', () => {
  it('draws Lock as a padlock even where there is room for the word', () => {
    roomBar({ inside: true, width: 400 })

    const lock = screen.getByRole('button', { name: 'Lock' })
    expect(lock).not.toHaveTextContent('Lock')
    expect(lock.querySelector('svg')).not.toBeNull()
  })

  it('draws Unlock as a padlock too', () => {
    roomBar({ inside: true, locked: true, width: 400 })

    const unlock = screen.getByRole('button', { name: 'Unlock' })
    expect(unlock).not.toHaveTextContent('Unlock')
    expect(unlock.querySelector('svg')).not.toBeNull()
  })

  it('keeps Knock a word, with no icon, wide or narrow', () => {
    for (const width of [400, 120, 80]) {
      const view = roomBar({ locked: true, width })
      const knock = screen.getByRole('button', { name: 'Knock' })
      expect(knock).toHaveTextContent('Knock')
      expect(knock.querySelector('svg')).toBeNull()
      view.unmount()
    }
  })
})

describe('a note from the host', () => {
  it('shows under the bar when nothing more urgent does', () => {
    roomBar({ notice: 'Booked 10:00–11:00: Planning' })
    expect(screen.getByText('Booked 10:00–11:00: Planning')).toBeTruthy()
  })

  it('gives way to the reason you cannot go in', () => {
    roomBar({
      notice: 'Booked 10:00–11:00: Planning',
      forbiddenReason: 'This room is for members.',
    })
    expect(screen.getByText('This room is for members.')).toBeTruthy()
    expect(screen.queryByText('Booked 10:00–11:00: Planning')).toBeNull()
  })
})

/**
 * What the host adds.
 *
 * A Reserve the engine does not have to understand: drawn after the bar's own
 * controls, in the same clothes, and disabled the same way — visible, with the
 * reason in the message row.
 */
describe('the host’s actions on the bar', () => {
  it('draws them as secondary buttons after the bar’s own controls, and runs them', async () => {
    const reserve = vi.fn()
    const { user } = roomBar({
      actions: [{ id: 'reserve', label: 'Reserve', onSelect: reserve }],
    })

    const buttons = screen.getAllByRole('button').map((one) => one.textContent)
    expect(buttons).toEqual(['Join', 'Reserve'])
    expect(screen.getByRole('button', { name: 'Reserve' }).className).toMatch(/btn-secondary/)

    await user.click(screen.getByRole('button', { name: 'Reserve' }))
    expect(reserve).toHaveBeenCalledTimes(1)
  })

  it('keeps a disabled one visible, with its reason in the message row', () => {
    roomBar({
      actions: [
        {
          id: 'reserve',
          label: 'Reserve',
          disabled: 'Reserved by Grace until 15:00.',
          onSelect() {},
        },
      ],
    })

    const reserve = screen.getByRole('button', { name: 'Reserve' })
    expect(reserve).toBeDisabled()
    expect(reserve).toHaveAccessibleDescription('Reserved by Grace until 15:00.')
    expect(screen.getByText('Reserved by Grace until 15:00.')).toBeInTheDocument()
  })

  it('lets the bar’s own reason come first, and does not describe Reserve with it', () => {
    roomBar({
      forbiddenReason: 'This room is for members.',
      actions: [{ id: 'reserve', label: 'Reserve', disabled: 'Already reserved.', onSelect() {} }],
    })

    expect(screen.getByText('This room is for members.')).toBeInTheDocument()
    expect(screen.queryByText('Already reserved.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Reserve' })).not.toHaveAttribute('aria-describedby')
  })

  it('leaves them off a narrow bar, where Join is the one thing that must fit', () => {
    roomBar({ width: 120, actions: [{ id: 'reserve', label: 'Reserve', onSelect() {} }] })

    expect(screen.getByRole('button', { name: 'Join' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reserve' })).toBeNull()
  })
})
