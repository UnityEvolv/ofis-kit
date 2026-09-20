import type { ClientEvent, OfisClient } from '@unityevolv/ofiskit-realtime-client'
import { REACTIONS } from '@unityevolv/ofiskit-realtime-client'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ReactionFloat, ReactionPicker, describeReaction } from './Reactions.js'
import { REACTION_VISIBLE_MS, useReactions } from './useCall.js'

/**
 * Reacting without interrupting.
 *
 * The half worth testing is the disappearing. **Nothing is stored** — not on the
 * server, not in the office state, not in this hook — so a reaction that stayed
 * would be a bug that only shows up after a long meeting, as a screen covered in
 * an hour of other people's applause.
 */

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
    react(userId: string, deviceId: string, reaction: string) {
      for (const listener of [...listeners]) {
        listener({
          type: 'reaction',
          roomId: 'studio',
          userId,
          deviceId,
          reaction,
          at: '2026-01-01T09:00:00.000Z',
        })
      }
    },
  }
}

function Watching({ client }: { client: OfisClient }) {
  const reactions = useReactions(client)
  return (
    <ul>
      {[...reactions.byUser].map(([userId, live]) => (
        <li key={userId} data-testid={`by-user-${userId}`}>
          {live.map((one) => one.reaction).join('')}
        </li>
      ))}
      {[...reactions.byDevice].map(([deviceId, live]) => (
        <li key={deviceId} data-testid={`by-device-${deviceId}`}>
          {live.map((one) => one.reaction).join('')}
        </li>
      ))}
    </ul>
  )
}

afterEach(() => {
  vi.useRealTimers()
})

describe('a reaction in the air', () => {
  it('appears over the person who sent it', () => {
    vi.useFakeTimers()
    const { client, react } = fakeClient()
    render(<Watching client={client} />)

    act(() => react('ada', 'ada-laptop', '👏'))

    expect(screen.getByTestId('by-user-ada')).toHaveTextContent('👏')
    // And by device as well, because a tile is a screen and an avatar is a person.
    expect(screen.getByTestId('by-device-ada-laptop')).toHaveTextContent('👏')
  })

  it('clears on its own, with nobody having to dismiss it', () => {
    vi.useFakeTimers()
    const { client, react } = fakeClient()
    render(<Watching client={client} />)
    act(() => react('ada', 'ada-laptop', '👏'))

    act(() => {
      vi.advanceTimersByTime(REACTION_VISIBLE_MS + 10)
    })

    expect(screen.queryByTestId('by-user-ada')).not.toBeInTheDocument()
  })

  it('keeps two in the air at once, and expires each on its own clock', () => {
    vi.useFakeTimers()
    const { client, react } = fakeClient()
    render(<Watching client={client} />)

    act(() => react('ada', 'ada-laptop', '👏'))
    act(() => {
      vi.advanceTimersByTime(REACTION_VISIBLE_MS / 2)
    })
    act(() => react('ada', 'ada-laptop', '🎉'))

    expect(screen.getByTestId('by-user-ada')).toHaveTextContent('👏🎉')

    // The first one goes when its own few seconds are up, rather than both of them
    // being reset by the second.
    act(() => {
      vi.advanceTimersByTime(REACTION_VISIBLE_MS / 2 + 10)
    })
    expect(screen.getByTestId('by-user-ada')).toHaveTextContent('🎉')
  })

  it('keeps one person’s reaction off another person', () => {
    vi.useFakeTimers()
    const { client, react } = fakeClient()
    render(<Watching client={client} />)

    act(() => react('ada', 'ada-laptop', '👏'))

    expect(screen.queryByTestId('by-user-grace')).not.toBeInTheDocument()
  })
})

describe('the picker', () => {
  it('offers the set the server validates against, and no more', () => {
    render(<ReactionPicker onReact={() => {}} />)
    expect(screen.getAllByRole('button')).toHaveLength(REACTIONS.length)
  })

  it('gives every one a different name, because an emoji is not a label', () => {
    render(<ReactionPicker onReact={() => {}} />)

    // A screen reader reading "party popper" tells somebody nothing, and two
    // buttons announced identically are two buttons nobody can choose between.
    const names = screen.getAllByRole('button').map((one) => one.getAttribute('aria-label'))
    expect(names.every((name) => /^React with \w/.test(name ?? ''))).toBe(true)
    expect(new Set(names).size).toBe(REACTIONS.length)
  })

  it('sends exactly the one that was pressed', async () => {
    const user = userEvent.setup()
    const onReact = vi.fn()
    render(<ReactionPicker onReact={onReact} />)

    await user.click(screen.getByRole('button', { name: /react with celebration/i }))
    expect(onReact).toHaveBeenCalledWith('🎉')
  })

  it('refuses to be pressed when it is disabled', async () => {
    const user = userEvent.setup()
    const onReact = vi.fn()
    render(<ReactionPicker onReact={onReact} disabled />)

    await user.click(screen.getByRole('button', { name: /react with applause/i }))
    expect(onReact).not.toHaveBeenCalled()
  })
})

describe('what a live region says', () => {
  it('names the reaction rather than reading the emoji', () => {
    // A screen reader reading "party popper" tells somebody nothing about what
    // just happened in their meeting.
    expect(describeReaction('Ada', '🎉')).toBe('Ada reacted: celebration.')
  })

  it('still says something useful for a reaction it does not know', () => {
    // Which cannot happen through the server, but a sentence with a hole in it is
    // the worst possible failure for a live region.
    expect(describeReaction('Ada', '🦑')).toBe('Ada reacted.')
  })
})

describe('the float itself', () => {
  it('draws nothing at all when nothing is in the air', () => {
    const { container } = render(<ReactionFloat reactions={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('never takes a click meant for what is underneath it', () => {
    // A reaction that swallows the mute button is worse than no reaction.
    render(
      <ReactionFloat
        reactions={[{ id: 1, userId: 'ada', deviceId: 'ada-laptop', reaction: '👏' }]}
      />,
    )
    expect(screen.getByTestId('reaction-float').className).toMatch(/pointer-events-none/)
  })
})
