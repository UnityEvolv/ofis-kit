import type { PublicPresence } from '@unityevolv/ofiskit-realtime-client'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { OVERFLOW_COLUMNS, OVERFLOW_MAX_HEIGHT, OVERFLOW_ROWS, OverflowAvatar } from './Overflow.js'
import type { Token } from './placement.js'

/**
 * The people a room has no cell for.
 *
 * Drawn as people, both before and after the counter is opened. The rest of the
 * office shows everybody as a face with a status on it; a counter that opened onto
 * a list of names would be the one place where colleagues stopped looking like
 * colleagues.
 */

function person(userId: string, displayName = userId): PublicPresence {
  return {
    userId,
    displayName,
    roomId: 'studio',
    devices: [
      {
        deviceId: `${userId}-laptop`,
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
  }
}

const tokens = (count: number): Token[] =>
  Array.from({ length: count }, (_, index) => {
    const one = person(`p${index + 1}`, `Person ${index + 1}`)
    return { key: one.userId, person: one, linked: false }
  })

describe('the counter', () => {
  it('is drawn as an avatar, the size of the faces beside it', () => {
    render(<OverflowAvatar roomName="Studio" tokens={tokens(4)} size={50} />)

    const counter = screen.getByRole('button', { name: /4 more in studio/i })
    expect(counter).toHaveTextContent('+4')

    // The same proportion as a person's face, so it lines up with the row it is in
    // rather than looking laid on top of it.
    const face = within(counter).getByText('+4')
    expect(face).toHaveStyle({ width: '31px', height: '31px' })
    expect(face.className).toMatch(/rounded-full/)
  })

  it('says what it is to a screen reader, and what pressing it does', () => {
    render(<OverflowAvatar roomName="Studio" tokens={tokens(12)} size={50} />)

    expect(
      screen.getByRole('button', { name: '12 more in Studio. Activate to see them.' }),
    ).toBeInTheDocument()
  })

  it('keeps a two-digit count inside the circle', () => {
    // Three characters where there were two: the digits shrink rather than spill.
    render(<OverflowAvatar roomName="Studio" tokens={tokens(12)} size={50} />)

    const face = screen.getByText('+12')
    const font = Number.parseFloat(face.style.fontSize)
    expect(font).toBeLessThan(31 * 0.38)
  })
})

describe('the people behind it', () => {
  it('opens onto their avatars rather than a list of names', async () => {
    const user = userEvent.setup()
    render(<OverflowAvatar roomName="Studio" tokens={tokens(4)} size={50} />)

    await user.click(screen.getByRole('button', { name: /4 more in studio/i }))

    const grid = screen.getByRole('list', { name: /4 more in studio/i })
    // Each one is a person with a status, exactly as they are drawn in a room.
    expect(within(grid).getAllByTestId('person-avatar')).toHaveLength(4)
    expect(within(grid).getByRole('img', { name: /person 3, available/i })).toBeInTheDocument()
  })

  it('lays them out three across', async () => {
    const user = userEvent.setup()
    render(<OverflowAvatar roomName="Studio" tokens={tokens(5)} size={50} />)
    await user.click(screen.getByRole('button', { name: /5 more/i }))

    const grid = screen.getByTestId('overflow-grid')
    expect(OVERFLOW_COLUMNS).toBe(3)
    expect(grid.style.gridTemplateColumns).toBe('repeat(3, 60px)')
  })

  it('shows three rows and scrolls the rest, however many there are', async () => {
    // A room of forty people is a panel of nine faces and a scrollbar, not a panel
    // taller than the map it is floating over.
    const user = userEvent.setup()
    render(<OverflowAvatar roomName="Studio" tokens={tokens(40)} size={50} />)
    await user.click(screen.getByRole('button', { name: /40 more/i }))

    const grid = screen.getByTestId('overflow-grid')
    expect(OVERFLOW_ROWS).toBe(3)
    expect(grid.className).toMatch(/overflow-y-auto/)
    // Three rows of 72 and the two gaps between them — or less, where the screen has
    // less room than that. jsdom cannot evaluate min(), so the rule is checked as
    // written and the browser test checks what it does.
    expect(OVERFLOW_MAX_HEIGHT).toContain(`${3 * 72 + 2 * 4}px`)
    expect(OVERFLOW_MAX_HEIGHT).toContain('--radix-popover-content-available-height')
    // And nobody is dropped: scrolling reaches all of them.
    expect(within(grid).getAllByRole('listitem')).toHaveLength(40)
  })

  it('keeps them in the order they arrived', async () => {
    const user = userEvent.setup()
    render(<OverflowAvatar roomName="Studio" tokens={tokens(3)} size={50} />)
    await user.click(screen.getByRole('button', { name: /3 more/i }))

    const names = within(screen.getByTestId('overflow-grid'))
      .getAllByRole('img')
      .map((one) => one.getAttribute('aria-label')?.split(',')[0])
    expect(names).toEqual(['Person 1', 'Person 2', 'Person 3'])
  })
})

/**
 * Reachable without a mouse.
 *
 * The avatars in the list are pictures of people rather than controls, so nothing
 * inside it takes focus — which left the people after the ninth visible to a mouse
 * wheel and to nobody else.
 */
describe('the people behind it, from the keyboard', () => {
  it('opens onto the list, which can be scrolled from the keyboard', async () => {
    const user = userEvent.setup()
    render(<OverflowAvatar roomName="Studio" tokens={tokens(12)} size={50} />)

    screen.getByRole('button', { name: /12 more in studio/i }).focus()
    await user.keyboard('{Enter}')

    const grid = screen.getByTestId('overflow-grid')
    expect(grid).toHaveAttribute('tabindex', '0')
    // Focus goes to the named list rather than to the popover's frame.
    expect(grid).toHaveFocus()
  })

  it('names the popover after what is in it', async () => {
    const user = userEvent.setup()
    render(<OverflowAvatar roomName="Studio" tokens={tokens(12)} size={50} />)

    await user.click(screen.getByRole('button', { name: /12 more in studio/i }))

    // An unnamed dialog is announced as just "dialog", before anything useful.
    expect(screen.getByRole('dialog', { name: '12 more in Studio' })).toBeInTheDocument()
  })

  it('closes on Escape and gives focus back to the counter', async () => {
    const user = userEvent.setup()
    render(<OverflowAvatar roomName="Studio" tokens={tokens(4)} size={50} />)

    const counter = screen.getByRole('button', { name: /4 more in studio/i })
    await user.click(counter)
    await user.keyboard('{Escape}')

    expect(screen.queryByTestId('overflow-grid')).not.toBeInTheDocument()
    expect(counter).toHaveFocus()
  })
})
