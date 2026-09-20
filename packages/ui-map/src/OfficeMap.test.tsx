import type { OfficeSnapshot, PublicPresence } from '@unityevolv/ofiskit-realtime-client'
import { emptyOffice, fromSnapshot } from '@unityevolv/ofiskit-realtime-client'
import { createTemplate, type CanvasShape, type Template } from '@unityevolv/ofiskit-template'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { OfficeMap, RoomListView, type OfficeMapProps } from './OfficeMap.js'
import { ThemeProvider } from './theme.js'

/**
 * The map, from the outside.
 *
 * Queried by role throughout, which is not a stylistic choice here: a picture of
 * rooms is the easiest thing in the product to build as an unreachable pile of
 * divs, and a test that can only find things the way a screen reader finds them is
 * what stops that happening.
 */

/**
 * jsdom has no ResizeObserver and no layout, so the map would measure zero and
 * draw nothing. Stubbed to report a fixed size once, which is enough for every
 * assertion here — none of them is about pixels.
 */
beforeAll(() => {
  class FakeResizeObserver {
    readonly #callback: ResizeObserverCallback
    constructor(callback: ResizeObserverCallback) {
      this.#callback = callback
    }
    observe(target: Element) {
      this.#callback(
        [{ contentRect: { width: 1200, height: 675 } } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      )
      void target
    }
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver
})

function office(canvas: CanvasShape = 'landscape'): Template {
  return createTemplate({
    name: 'Test office',
    canvas,
    images: { light: 'office-light.webp', dark: 'office-dark.webp' },
  })
}

function person(overrides: Partial<PublicPresence> & { userId: string }): PublicPresence {
  return {
    displayName: overrides.userId,
    roomId: 'reception',
    devices: [{ deviceId: `${overrides.userId}-laptop`, kind: 'web' }],
    status: 'available',
    arrivedAt: '2026-01-01T09:00:00.000Z',
    ...overrides,
  }
}

function draw(
  options: {
    template?: Template
    people?: PublicPresence[]
    locks?: Array<{ roomId: string; lockedBy: string }>
    you?: string
    capacityOf?: OfficeMapProps['capacityOf']
    list?: boolean
  } = {},
) {
  const template = options.template ?? office()
  const snapshot: OfficeSnapshot = {
    officeId: 'office',
    seq: 1,
    people: options.people ?? [],
    locks: options.locks ?? [],
    you: { userId: options.you ?? 'ada', deviceId: 'ada-laptop' },
  }

  const handlers = {
    onJoin: vi.fn(),
    onKnock: vi.fn(),
    onLock: vi.fn(),
    onUnlock: vi.fn(),
  }

  const props: OfficeMapProps = {
    template,
    state: fromSnapshot(snapshot),
    imageUrl: (name) => `/office/${name}`,
    ...(options.capacityOf ? { capacityOf: options.capacityOf } : {}),
    ...handlers,
  }

  const view = render(
    <ThemeProvider>{options.list ? <RoomListView {...props} /> : <OfficeMap {...props} />}</ThemeProvider>,
  )

  const roomNamed = (name: string) => template.rooms.find((one) => one.name === name)
  const roomTyped = (type: string) => template.rooms.find((one) => one.type === type)

  return { ...handlers, template, props, view, roomNamed, roomTyped }
}

describe('the office map', () => {
  it('is a landmark region named after the office', () => {
    draw()
    expect(screen.getByRole('region', { name: /test office office map/i })).toBeInTheDocument()
  })

  it('makes every room a labelled group carrying what somebody needs to decide', () => {
    const { roomNamed } = draw({
      people: [person({ userId: 'grace', roomId: roomNamedId('Workspace') })],
    })

    function roomNamedId(name: string) {
      return office().rooms.find((one) => one.name === name)?.id ?? ''
    }

    // Name, type, occupancy, lock state, and what Enter does — in the order
    // somebody decides in: what is this, who is in it, can I get in.
    const workspace = screen.getByRole('group', { name: /^Workspace, workspace, 0 people, open/i })
    expect(workspace).toBeInTheDocument()
    expect(roomNamed('Workspace')).toBeDefined()
  })

  it('says how many people are in a room, and says it in singular', () => {
    const template = office()
    const workspace = template.rooms.find((one) => one.name === 'Workspace')!

    draw({ template, people: [person({ userId: 'grace', roomId: workspace.id })] })

    expect(screen.getByRole('group', { name: /Workspace,.*1 person/i })).toBeInTheDocument()
  })

  it('says a room is locked, and that Enter will knock rather than join', () => {
    const template = office()
    const workspace = template.rooms.find((one) => one.name === 'Workspace')!

    draw({ template, locks: [{ roomId: workspace.id, lockedBy: 'grace' }] })

    expect(
      screen.getByRole('group', { name: /Workspace,.*locked, press Enter to knock/i }),
    ).toBeInTheDocument()
  })

  it('says where you are, rather than offering to join the room you are in', () => {
    const template = office()
    const reception = template.rooms.find((one) => one.type === 'reception')!

    draw({ template, people: [person({ userId: 'ada', roomId: reception.id })] })

    expect(screen.getByRole('group', { name: /you are here/i })).toBeInTheDocument()
  })

  it('names the break room as a break room, not by its type alone', () => {
    draw()
    expect(screen.getByRole('group', { name: /break room/i })).toBeInTheDocument()
  })

  it('puts every room in the tab order in reading order', async () => {
    const person_ = userEvent.setup()
    const { template } = draw()

    const expected = [...template.rooms]
      .sort((a, b) =>
        Math.abs(a.rect.y - b.rect.y) < 0.08 ? a.rect.x - b.rect.x : a.rect.y - b.rect.y,
      )
      .map((one) => one.name)

    // Tabbing reaches each room and then the controls inside it, which is what the
    // story asks for: rooms in reading order, with the bar's controls reachable
    // inside the group. So the rooms are collected in the order they are reached
    // rather than assuming every stop is a room.
    const reached: string[] = []
    for (let step = 0; step < 20 && reached.length < expected.length; step += 1) {
      await person_.tab()
      const active = document.activeElement
      if (active?.getAttribute('role') === 'group') {
        reached.push(active.getAttribute('aria-label')?.split(',')[0] ?? '')
      }
    }

    expect(reached).toEqual(expected)
  })

  it('puts a room bar’s controls inside its room, reachable by tabbing on', async () => {
    const person_ = userEvent.setup()
    const template = office()
    draw({ template })

    screen.getByRole('group', { name: /^Workspace/i }).focus()
    await person_.tab()

    const workspace = template.rooms.find((one) => one.name === 'Workspace')!
    expect(screen.getByTestId(`room-bar-${workspace.id}`)).toContainElement(
      document.activeElement as HTMLElement,
    )
  })

  it('moves between rooms with the arrow keys', async () => {
    const person_ = userEvent.setup()
    draw()

    await person_.tab()
    const first = document.activeElement
    await person_.keyboard('{ArrowRight}')

    expect(document.activeElement).not.toBe(first)
    expect(document.activeElement?.getAttribute('role')).toBe('group')
  })

  it('joins a room from the keyboard with Enter', async () => {
    const person_ = userEvent.setup()
    const { onJoin, template } = draw()

    const target = screen.getByRole('group', { name: /^Workspace/i })
    target.focus()
    await person_.keyboard('{Enter}')

    expect(onJoin).toHaveBeenCalledWith(template.rooms.find((one) => one.name === 'Workspace')?.id)
  })

  it('knocks rather than joins when the room is locked', async () => {
    const person_ = userEvent.setup()
    const template = office()
    const workspace = template.rooms.find((one) => one.name === 'Workspace')!
    const { onJoin, onKnock } = draw({
      template,
      locks: [{ roomId: workspace.id, lockedBy: 'grace' }],
    })

    screen.getByRole('group', { name: /^Workspace/i }).focus()
    await person_.keyboard('{Enter}')

    expect(onKnock).toHaveBeenCalledWith(workspace.id)
    expect(onJoin).not.toHaveBeenCalled()
  })

  it('does nothing when Enter is pressed on the room you are already in', async () => {
    const person_ = userEvent.setup()
    const template = office()
    const reception = template.rooms.find((one) => one.type === 'reception')!
    const { onJoin } = draw({
      template,
      people: [person({ userId: 'ada', roomId: reception.id })],
    })

    screen.getByRole('group', { name: /you are here/i }).focus()
    await person_.keyboard('{Enter}')

    expect(onJoin).not.toHaveBeenCalled()
  })

  it('shows the light image in light mode and the dark one in dark mode', () => {
    // Theme is per person, so two people standing in the same room may be looking
    // at different pictures over identical geometry.
    document.documentElement.dataset.theme = 'light'
    const { view } = draw()
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe('/office/office-light.webp')

    view.unmount()
    // The theme provider's own storage, which is a plain string rather than JSON.
    localStorage.setItem('ofiskit:theme', 'dark')
    const dark = draw()
    expect(dark.view.container.querySelector('img')?.getAttribute('src')).toBe(
      '/office/office-dark.webp',
    )
    localStorage.clear()
  })

  it('announces the people in a room as a list', () => {
    const template = office()
    const workspace = template.rooms.find((one) => one.name === 'Workspace')!
    draw({
      template,
      people: [person({ userId: 'grace', roomId: workspace.id })],
    })

    const list = screen.getByRole('list', { name: /people in Workspace/i })
    expect(within(list).getByRole('img', { name: /grace, available/i })).toBeInTheDocument()
  })

  it('counts the rest behind a button when a room holds more people than cells', async () => {
    // The seeded workspace has one 2x1 area, so two cells and five people is one
    // face and a +4 — the counter takes the last cell rather than the room
    // overflowing.
    const person_ = userEvent.setup()
    const template = office()
    const workspace = template.rooms.find((one) => one.name === 'Workspace')!

    draw({
      template,
      people: ['a', 'b', 'c', 'd', 'e'].map((id, index) =>
        person({
          userId: id,
          roomId: workspace.id,
          arrivedAt: `2026-01-01T09:0${index}:00.000Z`,
        }),
      ),
    })

    const counter = screen.getByRole('button', { name: /more in Workspace/i })
    expect(counter).toHaveTextContent('+4')

    await person_.click(counter)
    expect(screen.getByText('e')).toBeInTheDocument()
  })

  it('shows a disabled join with the reason under it when a room is full', () => {
    const template = office()
    const workspace = template.rooms.find((one) => one.name === 'Workspace')!

    draw({
      template,
      capacityOf: (room) => (room.id === workspace.id ? 1 : null),
      people: [person({ userId: 'grace', roomId: workspace.id })],
    })

    // Disabled and visible, never hidden: somebody has to know that joining is a
    // thing that exists and why they cannot do it right now.
    const bar = screen.getByTestId(`room-bar-${workspace.id}`)
    const join = within(bar).getByRole('button', { name: /join/i })
    expect(join).toBeDisabled()
    expect(within(bar).getByText(/Workspace is full/i)).toBeInTheDocument()
  })

  it('carries no message row at all when there is nothing to say', () => {
    const template = office()
    const workspace = template.rooms.find((one) => one.name === 'Workspace')!
    draw({ template })

    const bar = screen.getByTestId(`room-bar-${workspace.id}`)
    // An empty row would put a blank line under every open room in the office.
    expect(within(bar).queryByText(/full|locked|guest/i)).not.toBeInTheDocument()
    expect(bar.querySelector('p')).toBeNull()
  })

  it('offers lock to somebody inside a lockable room, and unlock once it is locked', async () => {
    const person_ = userEvent.setup()
    const template = office()
    const workspace = template.rooms.find((one) => one.name === 'Workspace')!

    const open = draw({
      template,
      people: [person({ userId: 'ada', roomId: workspace.id })],
    })

    const bar = screen.getByTestId(`room-bar-${workspace.id}`)
    await person_.click(within(bar).getByRole('button', { name: /^lock$/i }))
    expect(open.onLock).toHaveBeenCalledWith(workspace.id)

    open.view.unmount()

    const locked = draw({
      template,
      people: [person({ userId: 'ada', roomId: workspace.id })],
      locks: [{ roomId: workspace.id, lockedBy: 'ada' }],
    })
    const lockedBar = screen.getByTestId(`room-bar-${workspace.id}`)
    await person_.click(within(lockedBar).getByRole('button', { name: /unlock/i }))
    expect(locked.onUnlock).toHaveBeenCalledWith(workspace.id)
  })

  it('offers no lock in reception, which is open to everyone by design', () => {
    const template = office()
    const reception = template.rooms.find((one) => one.type === 'reception')!

    draw({ template, people: [person({ userId: 'ada', roomId: reception.id })] })

    const bar = screen.getByTestId(`room-bar-${reception.id}`)
    expect(within(bar).queryByRole('button', { name: /lock/i })).not.toBeInTheDocument()
  })
})

describe('before the office has arrived', () => {
  /** The map with no snapshot yet, which is what a reload starts from. */
  function notReady(list = false) {
    const props: OfficeMapProps = {
      template: office(),
      state: emptyOffice('office'),
      imageUrl: (name) => `/office/${name}`,
      onJoin: vi.fn(),
      onKnock: vi.fn(),
      onLock: vi.fn(),
      onUnlock: vi.fn(),
    }
    return render(
      <ThemeProvider>{list ? <RoomListView {...props} /> : <OfficeMap {...props} />}</ThemeProvider>,
    )
  }

  it('says it is still looking rather than drawing an empty office', () => {
    // Drawing the rooms with nobody in them would be a lie for a moment, and it
    // is the worst possible moment for one: somebody reloading sees an empty
    // office and believes it before the people appear.
    notReady()

    expect(screen.getByRole('status')).toHaveTextContent(/looking around the office/i)
    expect(screen.queryAllByRole('group')).toHaveLength(0)
  })

  it('says the same thing in the list view', () => {
    notReady(true)
    expect(screen.getByRole('status')).toHaveTextContent(/looking around the office/i)
    expect(screen.queryAllByTestId(/^room-bar-/)).toHaveLength(0)
  })
})

describe('a move on the map', () => {
  it('animates the position, so the eye can follow who went where', () => {
    const template = office()
    const room = template.rooms.find((one) => one.name === 'Workspace')!

    draw({ template, people: [person({ userId: 'grace', roomId: room.id })] })

    // The avatar's cell is positioned, and the transition is on `left` and `top`,
    // so a move is something the browser animates rather than a person vanishing
    // from one room and appearing in another.
    const cell = screen.getByRole('img', { name: /^grace,/i }).closest('li')
    expect(cell?.style.transition).toMatch(/left .* ease, top .* ease/)
  })

  it('does not animate for somebody who asked for less motion', () => {
    // Motion is the part of this product most likely to make somebody feel
    // unwell, and a map where everything slides is the worst case of it.
    const matchMedia = globalThis.matchMedia
    globalThis.matchMedia = ((query: string) =>
      ({
        matches: query.includes('reduced-motion'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList) as typeof globalThis.matchMedia

    const template = office()
    const room = template.rooms.find((one) => one.name === 'Workspace')!
    draw({ template, people: [person({ userId: 'grace', roomId: room.id })] })

    const cell = screen.getByRole('img', { name: /^grace,/i }).closest('li')
    expect(cell?.style.transition).toBe('')

    globalThis.matchMedia = matchMedia
  })
})

describe('the list view', () => {
  it('shows the same office as the map, with the same actions', async () => {
    const person_ = userEvent.setup()
    const template = office()
    const workspace = template.rooms.find((one) => one.name === 'Workspace')!

    const { onJoin } = draw({
      template,
      list: true,
      people: [person({ userId: 'grace', roomId: workspace.id })],
    })

    expect(screen.getByRole('navigation', { name: /test office rooms/i })).toBeInTheDocument()

    const bar = screen.getByTestId(`room-bar-${workspace.id}`)
    // Never compact here: this is the view somebody chose because they wanted
    // words rather than a picture.
    expect(within(bar).getByRole('button', { name: /join/i })).toHaveTextContent('Join')

    const people = screen.getByRole('list', { name: /people in Workspace/i })
    expect(within(people).getByRole('img', { name: /grace/i })).toBeInTheDocument()

    await person_.click(within(bar).getByRole('button', { name: /join/i }))
    expect(onJoin).toHaveBeenCalledWith(workspace.id)
  })

  it('lists the rooms in the same order the map tabs through them', () => {
    const { template } = draw({ list: true })
    const expected = [...template.rooms]
      .sort((a, b) =>
        Math.abs(a.rect.y - b.rect.y) < 0.08 ? a.rect.x - b.rect.x : a.rect.y - b.rect.y,
      )
      .map((one) => one.name)

    const names = screen
      .getAllByTestId(/^room-bar-/)
      .map((bar) => bar.querySelector('span[title]')?.getAttribute('title'))

    expect(names).toEqual(expected)
  })
})
