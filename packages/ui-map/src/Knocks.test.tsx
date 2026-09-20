import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { KnockDock, OutgoingKnock, type IncomingKnock } from './Knocks.js'

/**
 * Both sides of somebody being at the door.
 *
 * The worst version of this feature is knocking into silence and never learning
 * whether anybody saw it, so most of what is tested here is that every outcome is
 * said — including the one where nobody answered.
 */

function knock(overrides: Partial<IncomingKnock> = {}): IncomingKnock {
  return {
    knockId: 'k1',
    roomId: 'studio',
    userId: 'alan',
    displayName: 'Alan',
    silent: false,
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('inside the room', () => {
  it('shows nothing at all when nobody is knocking', () => {
    const { container } = render(
      <KnockDock knocks={[]} onAdmit={() => {}} onDecline={() => {}} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('is a landmark somebody can jump to while a colleague waits outside', () => {
    render(<KnockDock knocks={[knock()]} onAdmit={() => {}} onDecline={() => {}} />)
    expect(screen.getByRole('region', { name: /people knocking/i })).toBeInTheDocument()
  })

  it('says who is knocking, and offers both answers', () => {
    render(<KnockDock knocks={[knock()]} onAdmit={() => {}} onDecline={() => {}} />)

    expect(screen.getByText(/alan/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /let them in/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /not now/i })).toBeInTheDocument()
  })

  it('says that letting somebody in does not unlock the room', () => {
    // On the card rather than left to be discovered, because "let them in" reads
    // like unlocking the door and it is not that.
    render(<KnockDock knocks={[knock()]} onAdmit={() => {}} onDecline={() => {}} />)
    expect(screen.getByText(/does not unlock the room for anyone else/i)).toBeInTheDocument()
  })

  it('admits and declines by knock, so two people at the door do not get confused', async () => {
    const user = userEvent.setup()
    const onAdmit = vi.fn()
    const onDecline = vi.fn()

    render(
      <KnockDock
        knocks={[knock(), knock({ knockId: 'k2', userId: 'bob', displayName: 'Bob' })]}
        onAdmit={onAdmit}
        onDecline={onDecline}
      />,
    )

    const bob = screen.getByTestId('knock-k2')
    await user.click(bob.querySelector('button')!)
    expect(onAdmit).toHaveBeenCalledWith('k2')

    const alan = screen.getByTestId('knock-k1')
    await user.click(alan.querySelectorAll('button')[1]!)
    expect(onDecline).toHaveBeenCalledWith('k1')
  })
})

describe('outside the room', () => {
  it('says the knock was sent, so the button did not appear to do nothing', () => {
    render(
      <OutgoingKnock roomName="Studio" outcome="waiting" onDismiss={() => {}} />,
    )
    expect(screen.getByTestId('outgoing-knock')).toHaveTextContent(/knocked on Studio.*waiting for an answer/i)
  })

  it('says when it arrived silently, so an unanswered knock makes sense', () => {
    // Do not disturb suppresses interruption, not access — and the knocker is
    // told, or they are left wondering whether it worked.
    render(<OutgoingKnock roomName="Studio" outcome="waiting" silent onDismiss={() => {}} />)
    expect(screen.getByTestId('outgoing-knock')).toHaveTextContent(/on do not disturb, so it arrived silently/i)
  })

  it('says every outcome plainly, including nobody answering', () => {
    for (const [outcome, matcher] of [
      ['admitted', /let into Studio/i],
      ['declined', /not right now/i],
      ['expired', /nobody answered/i],
    ] as const) {
      const { unmount } = render(
        <OutgoingKnock roomName="Studio" outcome={outcome} onDismiss={() => {}} />,
      )
      expect(screen.getByTestId('outgoing-knock')).toHaveTextContent(matcher)
      unmount()
    }
  })

  it('explains a refusal rather than dropping the knock', () => {
    // Repeated knocking is rate limited. A button that appears to do nothing is
    // worse than a button that says no.
    render(
      <OutgoingKnock
        roomName="Studio"
        outcome="refused"
        message="You have knocked a few times already. Try again in 44 seconds."
        onDismiss={() => {}}
      />,
    )
    expect(screen.getByTestId('outgoing-knock')).toHaveTextContent(/try again in 44 seconds/i)
  })

  it('clears itself once there is an answer, and waits as long as the waiting does', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()

    const waiting = render(
      <OutgoingKnock roomName="Studio" outcome="waiting" onDismiss={onDismiss} />,
    )
    vi.advanceTimersByTime(60_000)
    expect(onDismiss).not.toHaveBeenCalled()
    waiting.unmount()

    render(<OutgoingKnock roomName="Studio" outcome="declined" onDismiss={onDismiss} />)
    vi.advanceTimersByTime(6000)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('can be dismissed by hand', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()

    render(<OutgoingKnock roomName="Studio" outcome="waiting" onDismiss={onDismiss} />)
    await user.click(screen.getByRole('button', { name: /dismiss/i }))

    expect(onDismiss).toHaveBeenCalled()
  })
})
