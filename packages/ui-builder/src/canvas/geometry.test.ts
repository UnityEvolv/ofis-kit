import { avatarUnit, createTemplate, usableRect, type Template } from '@unityevolv/ofiskit-template'
import { describe, expect, it } from 'vitest'

import {
  GRID,
  addArea,
  addRoom,
  areaAt,
  moveArea,
  moveRoom,
  nudgeArea,
  nudgeRoom,
  onResizeCorner,
  placeArea,
  resizeRoom,
  roomAt,
  snapRoom,
} from './geometry.js'

/**
 * What a drag means, tested without a drag.
 *
 * These rules used to live inside the pointer handlers, where the only way to
 * check any of them was to render the builder and move a fake pointer across it.
 * They are ordinary functions from a template to a template, and this is the file
 * that gets to be specific about the edges: what happens when a room is dragged
 * past the canvas, when an area is nudged into a wall, when two rooms overlap and
 * a click has to pick one.
 */

const office = (): Template =>
  createTemplate({ name: 'Test office', canvas: 'landscape', images: { light: 'o.webp' } })

const unitOf = (template: Template) => avatarUnit(template.canvas, template.avatarSize)
const workspace = (template: Template) =>
  template.rooms.find((room) => room.type === 'workspace') ?? template.rooms[0]!

describe('snapping a room edge', () => {
  it('lands on the grid when there is nothing to line up with', () => {
    const template = { ...office(), rooms: [] }
    const [value, guide] = snapRoom(template, 0.4237, 'x')

    expect(value).toBeCloseTo(0.42, 10)
    expect(guide).toBeNull()
  })

  it('prefers a neighbour’s edge over the grid, and says which one', () => {
    // Lining up with the room next door is what the author is actually trying to
    // do; the grid is only there so a room with nothing near it lands tidily.
    const template = office()
    const neighbour = workspace(template)
    const [value, guide] = snapRoom(template, neighbour.rect.x + 0.004, 'x')

    expect(value).toBe(neighbour.rect.x)
    expect(guide).toBe(neighbour.rect.x)
  })

  it('ignores the room being dragged, so it cannot snap to itself', () => {
    const template = office()
    const room = workspace(template)
    const [, guide] = snapRoom(template, room.rect.x + 0.004, 'x', room.id)

    expect(guide).toBeNull()
  })
})

describe('placing a user area', () => {
  it('moves on the grid rather than on the avatar lattice', () => {
    // The bug this replaced: one avatar unit is about a sixth of the height of a
    // landscape office, so a room had two or three places an area could be.
    const template = office()
    const room = workspace(template)
    const unit = unitOf(template)
    const usable = usableRect(room, template.canvas)

    const placed = placeArea({ x: usable.x + GRID, y: usable.y + GRID }, { columns: 1, rows: 1 }, usable, unit)

    expect(placed.x - usable.x).toBeLessThan(unit.width)
    expect(placed.y - usable.y).toBeLessThan(unit.height)
  })

  it('keeps the whole area inside the room, not just its corner', () => {
    const template = office()
    const room = workspace(template)
    const unit = unitOf(template)
    const usable = usableRect(room, template.canvas)

    const placed = placeArea({ x: 5, y: 5 }, { columns: 2, rows: 1 }, usable, unit)

    expect(placed.x + 2 * unit.width).toBeLessThanOrEqual(usable.x + usable.width + 1e-9)
    expect(placed.y + unit.height).toBeLessThanOrEqual(usable.y + usable.height + 1e-9)
  })

  it('gives up rather than inverting when the area is wider than its room', () => {
    // A room can be resized smaller than something already in it, and a clamp
    // with its ends crossed returns a number from nowhere.
    const usable = { x: 0.2, y: 0.2, width: 0.05, height: 0.05 }
    const placed = placeArea({ x: 0.9, y: 0.9 }, { columns: 4, rows: 4 }, usable, {
      width: 0.06,
      height: 0.06,
    })

    expect(placed).toEqual({ x: 0.2, y: 0.2 })
  })
})

describe('deciding what was clicked', () => {
  it('picks the most recently drawn room where two overlap', () => {
    // Which is the one the author just drew, and therefore the one they mean.
    const template = office()
    const first = workspace(template)
    const onTop = { ...first, id: 'newer', name: 'Newer' }
    const stacked = { ...template, rooms: [...template.rooms, onTop] }

    expect(roomAt(stacked, { x: first.rect.x + 0.01, y: first.rect.y + 0.01 })?.id).toBe('newer')
  })

  it('finds an area under the point, with the room it belongs to', () => {
    const template = office()
    const room = workspace(template)
    const area = room.areas[0]!

    const hit = areaAt(template, { x: area.x + 0.001, y: area.y + 0.001 })
    expect(hit?.area.id).toBe(area.id)
    expect(hit?.room.id).toBe(room.id)
  })

  it('knows the resize corner from the rest of the room', () => {
    const room = workspace(office())
    const corner = { x: room.rect.x + room.rect.width, y: room.rect.y + room.rect.height }

    expect(onResizeCorner(room, corner)).toBe(true)
    expect(onResizeCorner(room, { x: room.rect.x + 0.05, y: room.rect.y + 0.05 })).toBe(false)
  })
})

describe('moving and resizing a room', () => {
  it('takes the room’s user areas with it', () => {
    // Leaving them behind puts every one of them outside its room, which is a
    // validation error the author did not ask for.
    const template = office()
    const room = workspace(template)
    const area = room.areas[0]!

    const moved = moveRoom(template, room.id, { x: room.rect.x + 0.1, y: room.rect.y })
    const after = moved.rooms.find((one) => one.id === room.id)?.areas[0]

    expect(after?.x).toBeCloseTo(area.x + 0.1, 10)
    expect(after?.y).toBeCloseTo(area.y, 10)
  })

  it('stops at the edge of the canvas rather than leaving it', () => {
    const template = office()
    const room = workspace(template)

    const moved = moveRoom(template, room.id, { x: 5, y: 5 })
    const after = moved.rooms.find((one) => one.id === room.id)!

    expect(after.rect.x + after.rect.width).toBeCloseTo(1, 10)
    expect(after.rect.y + after.rect.height).toBeCloseTo(1, 10)
  })

  it('never resizes a room smaller than one avatar', () => {
    const template = office()
    const room = workspace(template)
    const unit = unitOf(template)

    const resized = resizeRoom(template, room.id, { x: room.rect.x, y: room.rect.y }, unit)
    const after = resized.rooms.find((one) => one.id === room.id)!

    expect(after.rect.width).toBeCloseTo(unit.width, 10)
    expect(after.rect.height).toBeCloseTo(unit.height, 10)
  })
})

describe('adding things', () => {
  it('opens a new room with one area in the middle of it', () => {
    const template = { ...office(), rooms: [] }
    const unit = unitOf(template)
    const added = addRoom(template, { x: 0.1, y: 0.1, width: 0.3, height: 0.3 }, unit, 'room-1')
    const room = added.rooms[0]!

    expect(room.areas).toHaveLength(1)
    expect(room.bar).toBe('top')
    // Ready to adjust rather than empty: an author who draws a room and gets
    // nowhere to stand has to do a second thing before the room means anything.
    expect(room.areas[0]?.columns).toBe(1)
  })

  it('counts a drawn area in whole cells, and never in none', () => {
    const template = office()
    const room = workspace(template)
    const unit = unitOf(template)

    const added = addArea(
      template,
      room.id,
      { x: room.rect.x, y: room.rect.y, width: unit.width * 2.4, height: 0 },
      unit,
      'area-new',
    )
    const area = added.rooms.find((one) => one.id === room.id)?.areas.at(-1)

    expect(area?.columns).toBe(2)
    expect(area?.rows).toBe(1)
  })
})

describe('the keyboard', () => {
  it('nudges a room by the step it is given', () => {
    const template = office()
    const room = workspace(template)

    const moved = nudgeRoom(template, room.id, { x: 1, y: 0 }, GRID)
    expect(moved.rooms.find((one) => one.id === room.id)?.rect.x).toBeCloseTo(
      room.rect.x + GRID,
      10,
    )
  })

  it('resizes instead of moving when asked to', () => {
    const template = office()
    const room = workspace(template)

    const resized = nudgeRoom(template, room.id, { x: 1, y: 0 }, GRID, { resize: true })
    const after = resized.rooms.find((one) => one.id === room.id)!

    expect(after.rect.x).toBe(room.rect.x)
    expect(after.rect.width).toBeCloseTo(room.rect.width + GRID, 10)
  })

  it('will not walk a user area out of its room, however many presses', () => {
    const template = office()
    const room = workspace(template)
    const area = room.areas[0]!
    const unit = unitOf(template)
    const usable = usableRect(room, template.canvas)

    let walked = template
    for (let press = 0; press < 40; press += 1) {
      walked = nudgeArea(walked, room.id, area.id, { x: 1, y: 0 }, GRID * 5, unit)
    }

    const after = walked.rooms.find((one) => one.id === room.id)?.areas[0]
    expect(after).toBeDefined()
    expect((after?.x ?? 0) + (after?.columns ?? 0) * unit.width).toBeLessThanOrEqual(
      usable.x + usable.width + 1e-9,
    )
  })

  it('leaves a template alone when the thing being nudged is gone', () => {
    const template = office()
    expect(nudgeRoom(template, 'not-a-room', { x: 1, y: 0 }, GRID)).toEqual(template)
    expect(moveArea(template, 'not-a-room', 'nor-an-area', { x: 0, y: 0 }, unitOf(template))).toEqual(
      template,
    )
  })
})
