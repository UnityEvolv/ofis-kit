import { CANVAS_RATIO } from '@unityevolv/ofiskit-template'
import { describe, expect, it } from 'vitest'

import { fitCanvas, readingOrder, roomInDirection, tilePlacement, toPixels } from './layout.js'

const room = (id: string, x: number, y: number, width = 0.2, height = 0.2) => ({
  id,
  rect: { x, y, width, height },
})

describe('fitting the canvas into the space there is', () => {
  it('letterboxes rather than cropping, on a container that is too tall', () => {
    // Cropping would be prettier and is not an option: a room at the edge of the
    // canvas would be cut off, and somebody would be standing in a room nobody
    // can click.
    const box = fitCanvas('landscape', { width: 1600, height: 1200 })

    expect(box.width).toBe(1600)
    expect(Math.round(box.height)).toBe(Math.round(1600 / CANVAS_RATIO.landscape))
    expect(box.top).toBeGreaterThan(0)
    expect(box.left).toBe(0)
  })

  it('letterboxes on a container that is too wide', () => {
    const box = fitCanvas('portrait', { width: 1600, height: 800 })

    expect(box.height).toBe(800)
    expect(Math.round(box.width)).toBe(Math.round(800 * CANVAS_RATIO.portrait))
    expect(box.left).toBeGreaterThan(0)
  })

  it('centres the canvas in whatever is left over', () => {
    const box = fitCanvas('square', { width: 1000, height: 600 })
    expect(box.left).toBeCloseTo((1000 - box.width) / 2)
    expect(box.top).toBeCloseTo((600 - box.height) / 2)
  })

  it('returns nothing for a container with no size yet', () => {
    // The first render happens before the ResizeObserver has measured anything,
    // and drawing an office into zero pixels is worse than drawing none.
    expect(fitCanvas('landscape', { width: 0, height: 0 })).toEqual({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    })
  })

  it('turns a normalized rectangle into pixels inside the canvas', () => {
    const canvas = { left: 50, top: 10, width: 800, height: 450 }
    expect(toPixels({ x: 0.5, y: 0.2, width: 0.25, height: 0.4 }, canvas)).toEqual({
      left: 50 + 400,
      top: 10 + 90,
      width: 200,
      height: 180,
    })
  })
})

describe('where the call tiles go', () => {
  it('puts them across the top of a landscape office and beside a tall one', () => {
    // A landscape office has width to spare and height at a premium. A square or
    // portrait one is the other way round.
    expect(tilePlacement('landscape')).toBe('top')
    expect(tilePlacement('square')).toBe('right')
    expect(tilePlacement('portrait')).toBe('right')
  })
})

describe('reading order, which is also the tab order', () => {
  it('goes left to right, then top to bottom', () => {
    const rooms = [room('c', 0.7, 0.1), room('a', 0.1, 0.1), room('d', 0.1, 0.6), room('b', 0.4, 0.1)]
    expect(readingOrder(rooms).map((one) => one.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('treats rooms whose tops differ by a hair as the same row', () => {
    // Otherwise a tab order jumps around the screen because two rooms an author
    // drew side by side are three pixels apart vertically.
    const rooms = [room('right', 0.6, 0.102), room('left', 0.1, 0.1)]
    expect(readingOrder(rooms).map((one) => one.id)).toEqual(['left', 'right'])
  })
})

describe('the arrow keys', () => {
  const rooms = [
    room('left', 0.05, 0.4),
    room('middle', 0.4, 0.4),
    room('right', 0.75, 0.4),
    room('below', 0.4, 0.75),
  ]
  const middle = rooms[1]!

  it('moves to the room beside you, not the nearest one in any direction', () => {
    expect(roomInDirection(rooms, middle, 'right')?.id).toBe('right')
    expect(roomInDirection(rooms, middle, 'left')?.id).toBe('left')
    expect(roomInDirection(rooms, middle, 'down')?.id).toBe('below')
  })

  it('prefers a room in line with you over one that is closer but off to the side', () => {
    // The penalty for drifting sideways is what makes this feel like moving
    // through a grid rather than jumping diagonally across the office.
    const diagonal = [room('here', 0.4, 0.4), room('close-but-diagonal', 0.5, 0.75), room('straight-down', 0.4, 0.8)]
    expect(roomInDirection(diagonal, diagonal[0]!, 'down')?.id).toBe('straight-down')
  })

  it('stays put at the edge of the office', () => {
    expect(roomInDirection(rooms, rooms[0]!, 'left')).toBeNull()
    expect(roomInDirection(rooms, middle, 'up')).toBeNull()
  })
})
