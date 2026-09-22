import {
  avatarUnit,
  createTemplate,
  usableRect,
  validateTemplate,
  type Template,
} from '@unityevolv/ofiskit-template'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { OfficeBuilder } from './OfficeBuilder.js'

/**
 * The builder, from the outside.
 *
 * Queried by role throughout, which is the convention here and not only a
 * stylistic one: a drawing tool is the easiest kind of interface to build as an
 * unreachable pile of divs, and a test that can only find things by role is the
 * thing that stops that happening.
 */

function open(overrides: Partial<Template> = {}) {
  const onSave = vi.fn()
  const template = { ...createTemplate({ name: 'My office', canvas: 'landscape', images: { light: 'o.webp' } }), ...overrides }

  render(
    <OfficeBuilder
      template={template}
      imageUrl={null}
      saveLabel="Download template.json"
      onSave={onSave}
    />,
  )

  return { onSave, template }
}

/** Select a room the way somebody without a pointer has to. */
async function selectRoom(person: ReturnType<typeof userEvent.setup>, name: string) {
  const rooms = screen.getByRole('list', { name: 'Rooms' })
  await person.click(within(rooms).getByRole('button', { name: new RegExp(name, 'i') }))
}

describe('the office builder', () => {
  it('opens with a reception, a break room and a workspace already placed', () => {
    open()
    const rooms = screen.getByRole('list', { name: 'Rooms' })

    // An author who opens a drawing tool onto an empty canvas has to work out
    // what an office is made of before they can start.
    expect(within(rooms).getAllByRole('button')).toHaveLength(3)
    expect(within(rooms).getByRole('button', { name: /reception/i })).toBeInTheDocument()
    expect(within(rooms).getByRole('button', { name: /break/i })).toBeInTheDocument()
  })

  it('offers no way to delete the reception or the break room', async () => {
    const person = userEvent.setup()
    open()

    await selectRoom(person, 'reception')
    // Absent, not disabled: a template can never be short of a reception, so
    // deleting one is not something the builder has to refuse.
    expect(screen.queryByRole('button', { name: /delete room/i })).not.toBeInTheDocument()
  })

  it('lets a workspace be deleted', async () => {
    const person = userEvent.setup()
    open()

    await selectRoom(person, 'workspace')
    await person.click(screen.getByRole('button', { name: /delete room/i }))

    expect(within(screen.getByRole('list', { name: 'Rooms' })).getAllByRole('button')).toHaveLength(2)
  })

  it('will not let the type of a required room be changed', async () => {
    const person = userEvent.setup()
    open()

    await selectRoom(person, 'reception')

    // There is exactly one reception and exactly one break room, structurally,
    // so their type is not a choice to be offered and then refused.
    expect(screen.getByRole('combobox', { name: /type/i })).toBeDisabled()
  })

  it('puts the bar on whichever edge the author picks, per room', async () => {
    const person = userEvent.setup()
    const { onSave } = open()

    await selectRoom(person, 'workspace')
    await person.selectOptions(screen.getByRole('combobox', { name: /control bar/i }), 'bottom')

    await person.click(screen.getByRole('button', { name: /download template\.json/i }))

    const saved = onSave.mock.calls[0]?.[0] as Template
    expect(saved.rooms.find((room) => room.type === 'workspace')?.bar).toBe('bottom')
    // And only that room. The bar is per room because which edge is clearer
    // depends on what is drawn underneath it.
    expect(saved.rooms.find((room) => room.type === 'reception')?.bar).toBe('top')
  })

  it('renames a room, and the name is what gets saved', async () => {
    const person = userEvent.setup()
    const { onSave } = open()

    await selectRoom(person, 'workspace')
    const name = screen.getByRole('textbox', { name: /^name$/i })
    await person.clear(name)
    await person.type(name, 'The Studio')

    await person.click(screen.getByRole('button', { name: /download template\.json/i }))
    const saved = onSave.mock.calls[0]?.[0] as Template
    expect(saved.rooms.some((room) => room.name === 'The Studio')).toBe(true)
  })

  it('resizes a user area in whole cells and never in fractions', async () => {
    const person = userEvent.setup()
    const { onSave } = open()

    await selectRoom(person, 'workspace')
    await person.click(screen.getByRole('button', { name: /cells$/i }))

    const across = screen.getByRole('spinbutton', { name: /across/i })
    expect(across).toHaveValue(2)

    // Emptying the field resolves to one cell rather than to nothing, because
    // there is no such thing as a zero-cell area and a half-typed number should
    // not make the layout invalid while somebody is typing it.
    await person.clear(across)
    expect(across).toHaveValue(1)

    await person.click(screen.getByRole('button', { name: /download template\.json/i }))
    const saved = onSave.mock.calls.at(-1)?.[0] as Template
    const areas = saved.rooms.flatMap((room) => room.areas)

    expect(areas.some((one) => one.columns === 1)).toBe(true)
    // Whole units on both axes, always. A fractional area is not something the
    // author is warned about; it is something they cannot make.
    for (const one of areas) {
      expect(Number.isInteger(one.columns)).toBe(true)
      expect(Number.isInteger(one.rows)).toBe(true)
    }
  })

  it('rescales the grid when the avatar size changes', async () => {
    const person = userEvent.setup()
    const { onSave } = open()

    await person.selectOptions(screen.getByRole('combobox', { name: /avatar size/i }), 'large')
    await person.click(screen.getByRole('button', { name: /download template\.json/i }))

    expect((onSave.mock.calls[0]?.[0] as Template).avatarSize).toBe('large')
  })

  it('counts the rooms against the limit', () => {
    open()
    expect(screen.getByText(/3 of 30 rooms/i)).toBeInTheDocument()
  })

  it('says the layout is valid when it is, and emits it on save', async () => {
    const person = userEvent.setup()
    const { onSave, template } = open()

    expect(validateTemplate(template).ok).toBe(true)
    expect(screen.getByText(/this layout is valid/i)).toBeInTheDocument()

    await person.click(screen.getByRole('button', { name: /download template\.json/i }))
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('refuses to emit a layout that breaks a geometry rule, and says why', () => {
    // Two rooms on top of each other. The refusal is the disabled save plus the
    // reason beside it, because a save button that works and then produces a
    // broken office is worse than one that does not.
    const overlapping = createTemplate({
      name: 'Broken',
      canvas: 'landscape',
      images: { light: 'o.webp' },
    })
    const first = overlapping.rooms[0]
    const second = overlapping.rooms[1]
    expect(first && second).toBeTruthy()
    if (!first || !second) return

    open({
      rooms: [
        first,
        { ...second, rect: { ...first.rect } },
        ...overlapping.rooms.slice(2),
      ],
    })

    expect(screen.getByRole('button', { name: /download template\.json/i })).toBeDisabled()
    expect(screen.getByText(/to fix/i)).toBeInTheDocument()
  })

  it('emits a layout that survives being written to a file and read back', async () => {
    // Which is the whole of the claim that a template built here imports into
    // unityofis unchanged: the file the free app downloads and the layout the
    // wrappers store are the same schema, so a round trip through JSON has to
    // come back valid and identical.
    const person = userEvent.setup()
    const { onSave } = open()

    await person.click(screen.getByRole('button', { name: /download template\.json/i }))
    const saved = onSave.mock.calls[0]?.[0] as Template
    const reread = JSON.parse(JSON.stringify(saved)) as Template

    expect(reread).toEqual(saved)
    expect(validateTemplate(reread).ok).toBe(true)
  })

  it('moves the selected room with the arrow keys', async () => {
    const person = userEvent.setup()
    const { onSave, template } = open()

    await selectRoom(person, 'workspace')
    const canvas = screen.getByRole('application')
    canvas.focus()
    await person.keyboard('{ArrowRight}{ArrowRight}')

    await person.click(screen.getByRole('button', { name: /download template\.json/i }))
    const saved = onSave.mock.calls[0]?.[0] as Template
    const before = template.rooms.find((room) => room.type === 'workspace')?.rect.x ?? 0
    const after = saved.rooms.find((room) => room.type === 'workspace')?.rect.x ?? 0

    // Not a courtesy: an author who can select a room but cannot nudge it has a
    // tool they cannot use.
    expect(after).toBeGreaterThan(before)
  })

  it('takes a room’s user areas with it when it moves', async () => {
    const person = userEvent.setup()
    const { onSave, template } = open()

    await selectRoom(person, 'workspace')
    screen.getByRole('application').focus()
    await person.keyboard('{ArrowDown}')

    await person.click(screen.getByRole('button', { name: /download template\.json/i }))
    const saved = onSave.mock.calls[0]?.[0] as Template

    const before = template.rooms.find((room) => room.type === 'workspace')?.areas[0]?.y ?? 0
    const after = saved.rooms.find((room) => room.type === 'workspace')?.areas[0]?.y ?? 0
    expect(after).toBeGreaterThan(before)
    // And the result is still a layout somebody can save.
    expect(validateTemplate(saved).ok).toBe(true)
  })

  it('undoes the last change', async () => {
    const person = userEvent.setup()
    const { onSave } = open()

    await selectRoom(person, 'workspace')
    await person.click(screen.getByRole('button', { name: /delete room/i }))
    expect(within(screen.getByRole('list', { name: 'Rooms' })).getAllByRole('button')).toHaveLength(2)

    await person.click(screen.getByRole('button', { name: /^undo$/i }))
    expect(within(screen.getByRole('list', { name: 'Rooms' })).getAllByRole('button')).toHaveLength(3)

    await person.click(screen.getByRole('button', { name: /download template\.json/i }))
    expect((onSave.mock.calls[0]?.[0] as Template).rooms).toHaveLength(3)
  })
})

/**
 * Where a user area may sit.
 *
 * Its size is whole avatar units, and that is not in question. Its *position* was
 * snapped to the same lattice, which is a different rule wearing the same clothes:
 * one avatar unit is about a sixth of the height of a landscape office, so a room
 * had two or three places an area could be, and dragging one felt broken rather
 * than constrained.
 */
describe('placing a user area', () => {
  /** Select the workspace's first area the way somebody without a pointer has to. */
  async function selectArea(person: ReturnType<typeof userEvent.setup>) {
    await selectRoom(person, 'workspace')
    await person.click(screen.getByRole('button', { name: /cells$/i }))
    screen.getByRole('application').focus()
  }

  const workspace = (template: Template) => template.rooms.find((room) => room.type === 'workspace')

  it('moves by less than a whole avatar', async () => {
    const person = userEvent.setup()
    const { onSave, template } = open()
    const unit = avatarUnit(template.canvas, template.avatarSize)

    await selectArea(person)
    await person.keyboard('{ArrowRight}')

    await person.click(screen.getByRole('button', { name: /download template\.json/i }))
    const saved = onSave.mock.calls.at(-1)?.[0] as Template

    const before = workspace(template)?.areas[0]?.x ?? 0
    const after = workspace(saved)?.areas[0]?.x ?? 0
    expect(after).toBeGreaterThan(before)
    // The whole point: a step the old lattice could not express.
    expect(after - before).toBeLessThan(unit.width)
  })

  it('stays inside the room it belongs to, however long the key is held', async () => {
    const person = userEvent.setup()
    const { onSave, template } = open()
    const unit = avatarUnit(template.canvas, template.avatarSize)

    await selectArea(person)
    // Far more presses than the room is wide. The old bound was the canvas, which
    // walked an area out of its own room and left it there.
    await person.keyboard('{ArrowRight>20/}')

    await person.click(screen.getByRole('button', { name: /download template\.json/i }))
    const saved = onSave.mock.calls.at(-1)?.[0] as Template

    const room = workspace(saved)
    const area = room?.areas[0]
    expect(room && area).toBeTruthy()
    if (!room || !area) return

    const usable = usableRect(room, saved.canvas)
    expect(area.x).toBeGreaterThanOrEqual(usable.x)
    expect(area.x + area.columns * unit.width).toBeLessThanOrEqual(usable.x + usable.width + 1e-9)
    // And what comes out is still a layout somebody can save.
    expect(validateTemplate(saved).ok).toBe(true)
  })

  it('keeps its size in whole cells while it moves', async () => {
    const person = userEvent.setup()
    const { onSave, template } = open()

    await selectArea(person)
    await person.keyboard('{ArrowDown}{ArrowRight}')

    await person.click(screen.getByRole('button', { name: /download template\.json/i }))
    const saved = onSave.mock.calls.at(-1)?.[0] as Template

    // Moving freely is about position. Half an avatar is still not a place
    // anybody can stand.
    const before = workspace(template)?.areas[0]
    const after = workspace(saved)?.areas[0]
    expect(after?.columns).toBe(before?.columns)
    expect(after?.rows).toBe(before?.rows)
  })
})
