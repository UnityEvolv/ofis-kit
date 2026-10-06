import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AnnouncerProvider } from './Announcer.js'
import { ActionTarget, LONG_PRESS_MS, MoreActionsButton, type HostAction } from './HostActions.js'

/**
 * The host's menu, from the outside.
 *
 * Three ways in that a person might reach for — the right button, a held
 * finger, the menu key — and one that is drawn, and all of them open the one
 * menu. What matters here is what a screen reader and a keyboard get: a named
 * menu of menu items, a reason on anything disabled, and focus back where it
 * came from.
 */

function actions(overrides: Partial<HostAction>[] = []): HostAction[] {
  const base: HostAction[] = [
    { id: 'message', label: 'Message', onSelect: vi.fn() },
    { id: 'pin', label: 'Pin', onSelect: vi.fn() },
  ]
  return base.map((one, index) => ({ ...one, ...overrides[index] }))
}

function target(list: HostAction[] | null = actions(), withButton = false) {
  const view = render(
    <AnnouncerProvider>
      <p>Elsewhere</p>
      <ActionTarget as="div" name="Grace" actions={list} className="relative">
        <button type="button">Grace</button>
        {withButton && <MoreActionsButton label="More actions for Grace" />}
      </ActionTarget>
    </AnnouncerProvider>,
  )
  return { ...view, anchor: screen.getByRole('button', { name: 'Grace' }) }
}

describe('opening the menu', () => {
  it('opens on a right-click, with the actions as menu items', async () => {
    const user = userEvent.setup()
    const { anchor } = target()

    await user.pointer({ keys: '[MouseRight]', target: anchor })

    const menu = screen.getByRole('menu', { name: 'Actions for Grace' })
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Message', 'Pin'])
  })

  it('suppresses the browser’s own menu only when there is something to show instead', () => {
    const { anchor } = target()
    expect(fireEvent.contextMenu(anchor)).toBe(false)
  })

  it('leaves the browser’s menu alone, and opens nothing, when the host gave no actions', () => {
    const { anchor, unmount } = target(null)
    expect(fireEvent.contextMenu(anchor)).toBe(true)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    unmount()

    const empty = target([])
    expect(fireEvent.contextMenu(empty.anchor)).toBe(true)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.queryByTestId('action-menu-anchor')).not.toBeInTheDocument()
  })

  it('opens with Shift+F10 while something inside is focused', async () => {
    const user = userEvent.setup()
    const { anchor } = target()

    anchor.focus()
    await user.keyboard('{Shift>}{F10}{/Shift}')

    expect(screen.getByRole('menu', { name: 'Actions for Grace' })).toBeInTheDocument()
  })

  it('opens with the ContextMenu key', async () => {
    const user = userEvent.setup()
    const { anchor } = target()

    anchor.focus()
    await user.keyboard('{ContextMenu}')

    expect(screen.getByRole('menu', { name: 'Actions for Grace' })).toBeInTheDocument()
  })

  it('opens from the More-actions button, which says it has a menu', async () => {
    const user = userEvent.setup()
    target(actions(), true)

    const more = screen.getByRole('button', { name: 'More actions for Grace' })
    expect(more).toHaveAttribute('aria-haspopup', 'menu')
    expect(more).toHaveAttribute('aria-expanded', 'false')

    await user.click(more)

    expect(screen.getByRole('menu', { name: 'Actions for Grace' })).toBeInTheDocument()
    expect(more).toHaveAttribute('aria-expanded', 'true')
  })

  it('draws no More-actions button when there is nothing to open', () => {
    target([], true)
    expect(screen.queryByRole('button', { name: /more actions/i })).not.toBeInTheDocument()
  })

  it('says that it opened, through the live region', async () => {
    const user = userEvent.setup()
    const { anchor } = target()

    await user.pointer({ keys: '[MouseRight]', target: anchor })

    expect(screen.getByRole('status')).toHaveTextContent('Actions for Grace.')
  })
})

describe('a long press', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const press = (node: HTMLElement, at = { clientX: 10, clientY: 10 }) =>
    fireEvent.pointerDown(node, { pointerType: 'touch', isPrimary: true, ...at })

  it('opens the menu after half a second', () => {
    const { anchor } = target()

    press(anchor)
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS - 1)
    })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.getByRole('menu', { name: 'Actions for Grace' })).toBeInTheDocument()
  })

  it('is a tap, not a press, when the finger lifts first', () => {
    const { anchor } = target()

    press(anchor)
    fireEvent.pointerUp(anchor, { pointerType: 'touch' })
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS)
    })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('is a scroll, not a press, when the finger moves', () => {
    const { anchor } = target()

    press(anchor)
    fireEvent.pointerMove(anchor, { pointerType: 'touch', clientX: 10, clientY: 40 })
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS)
    })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('ignores a mouse held down, which is a drag', () => {
    const { anchor } = target()

    fireEvent.pointerDown(anchor, { pointerType: 'mouse', isPrimary: true })
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS)
    })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

describe('inside the menu', () => {
  it('moves between items with the arrow keys, and to the ends with Home and End', async () => {
    const user = userEvent.setup()
    const { anchor } = target()
    anchor.focus()
    await user.keyboard('{Shift>}{F10}{/Shift}')

    const [message, pin] = screen.getAllByRole('menuitem')
    expect(message).toHaveFocus()

    await user.keyboard('{ArrowDown}')
    expect(pin).toHaveFocus()
    await user.keyboard('{Home}')
    expect(message).toHaveFocus()
    await user.keyboard('{End}')
    expect(pin).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(message).toHaveFocus()
  })

  it('runs the action and closes when an item is chosen', async () => {
    const user = userEvent.setup()
    const list = actions()
    const { anchor } = target(list)

    await user.pointer({ keys: '[MouseRight]', target: anchor })
    await user.click(screen.getByRole('menuitem', { name: 'Pin' }))

    expect(list[1]!.onSelect).toHaveBeenCalledTimes(1)
    expect(list[0]!.onSelect).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes on Escape and gives focus back to what opened it', async () => {
    const user = userEvent.setup()
    const { anchor } = target()

    anchor.focus()
    await user.keyboard('{Shift>}{F10}{/Shift}')
    expect(anchor).not.toHaveFocus()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(anchor).toHaveFocus()
  })

  it('gives focus back to the More-actions button when that opened it', async () => {
    const user = userEvent.setup()
    target(actions(), true)
    const more = screen.getByRole('button', { name: 'More actions for Grace' })

    await user.click(more)
    await user.keyboard('{Escape}')

    expect(more).toHaveFocus()
  })

  it('closes on a click outside', async () => {
    // The kit's menu is modal: while it is open the page behind it has
    // pointer-events none, which user-event would refuse to click through.
    // The pointer still lands on the page in a browser, and that is the click
    // that closes it.
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const { anchor } = target()

    await user.pointer({ keys: '[MouseRight]', target: anchor })
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await user.click(screen.getByText('Elsewhere'))

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('shows a disabled item with its reason, as its hint and as its description', async () => {
    const user = userEvent.setup()
    const list = actions([{}, { disabled: 'Grace is in a call.' }])
    const { anchor } = target(list)

    await user.pointer({ keys: '[MouseRight]', target: anchor })

    const pin = screen.getByRole('menuitem', { name: /^Pin/ })
    expect(pin).toHaveAttribute('aria-disabled', 'true')
    expect(pin).toHaveAccessibleDescription('Grace is in a call.')
    expect(within(pin).getByText('Grace is in a call.')).toBeVisible()

    await user.click(pin)
    expect(list[1]!.onSelect).not.toHaveBeenCalled()
  })
})

describe('targets inside targets', () => {
  it('lets the innermost one with actions claim the gesture', async () => {
    const user = userEvent.setup()
    render(
      <ActionTarget as="div" name="Workspace" actions={actions()} className="relative">
        <ActionTarget as="span" name="Grace" actions={actions()} className="relative">
          <button type="button">Grace</button>
        </ActionTarget>
        <button type="button">Join</button>
      </ActionTarget>,
    )

    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByRole('button', { name: 'Grace' }),
    })
    expect(screen.getByRole('menu', { name: 'Actions for Grace' })).toBeInTheDocument()
    await user.keyboard('{Escape}')

    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByRole('button', { name: 'Join' }),
    })
    expect(screen.getByRole('menu', { name: 'Actions for Workspace' })).toBeInTheDocument()
  })

  it('passes a gesture on a person with no actions up to the room', async () => {
    const user = userEvent.setup()
    render(
      <ActionTarget as="div" name="Workspace" actions={actions()} className="relative">
        <ActionTarget as="span" name="Grace" actions={[]} className="relative">
          <button type="button">Grace</button>
        </ActionTarget>
      </ActionTarget>,
    )

    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByRole('button', { name: 'Grace' }),
    })
    expect(screen.getByRole('menu', { name: 'Actions for Workspace' })).toBeInTheDocument()
  })
})
