import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

/**
 * The harness, testing itself.
 *
 * Every component test after this one depends on four things working together:
 * jsdom, the React renderer, Testing Library's queries, and the jest-dom
 * matchers from the setup file. When a component test fails mysteriously, the
 * first question is whether the harness or the component is broken — this
 * answers it in one run, and it costs almost nothing to keep.
 *
 * It queries by role rather than by test id on purpose, because that is the
 * convention every test in this repository follows: a query by role only
 * succeeds if the markup is reachable the way an assistive technology reaches
 * it, so the accessibility rules in the definition of done are checked by the
 * ordinary tests rather than only by the axe run.
 */
function Knocker() {
  const [knocks, setKnocks] = useState(0)
  return (
    <button type="button" onClick={() => setKnocks(knocks + 1)}>
      Knocked {knocks} times
    </button>
  )
}

describe('the component harness', () => {
  it('renders, queries by role, and applies the jest-dom matchers', () => {
    render(<Knocker />)
    expect(screen.getByRole('button', { name: /knocked 0 times/i })).toBeInTheDocument()
  })

  it('handles a real interaction rather than a synthetic click', async () => {
    const person = userEvent.setup()
    render(<Knocker />)

    await person.click(screen.getByRole('button'))
    await person.click(screen.getByRole('button'))

    expect(screen.getByRole('button')).toHaveTextContent('Knocked 2 times')
  })
})
