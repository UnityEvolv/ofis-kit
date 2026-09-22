import { describe, expect, it } from 'vitest'

import { VIDEO_ASPECT, tileLayout } from './tileLayout.js'

/**
 * Filling the space a call has, without cropping anybody.
 *
 * Every tile is the video's own shape, so the question is only how many columns
 * make that shape biggest. These pin the answers for the screens people actually
 * have.
 */
describe('laying out a call', () => {
  it('fills a desktop window with a two-by-two for four people', () => {
    const layout = tileLayout(4, 1424, 784)

    expect(layout.columns).toBe(2)
    expect(layout.rows).toBe(2)
    // Most of the window, not a cluster of small tiles in the middle of it.
    expect(layout.tileWidth).toBeGreaterThan(600)
  })

  it('stacks four people in a column on a phone held upright', () => {
    // Four landscape pictures are bigger one above the other than side by side on a
    // screen that is taller than it is wide.
    const layout = tileLayout(4, 374, 560)

    expect(layout.columns).toBe(1)
    expect(layout.rows).toBe(4)
  })

  it('puts two people side by side on a wide screen, and one above the other on a tall one', () => {
    expect(tileLayout(2, 1424, 784).columns).toBe(2)
    expect(tileLayout(2, 374, 560).columns).toBe(1)
  })

  it('gives one person as much of the space as their picture can fill', () => {
    const layout = tileLayout(1, 1424, 784)

    expect(layout.columns).toBe(1)
    // Height-bound: a 16:9 picture as tall as the space is narrower than it.
    expect(layout.tileHeight).toBe(784)
  })

  it('keeps every tile the shape of the video, so nothing is cropped to fit', () => {
    for (const [count, width, height] of [
      [1, 1424, 784],
      [3, 1024, 600],
      [4, 374, 560],
      [5, 844, 300],
    ] as const) {
      const layout = tileLayout(count, width, height)
      expect(layout.tileWidth / layout.tileHeight).toBeCloseTo(VIDEO_ASPECT, 1)
    }
  })

  it('never lays out more than the space it was given', () => {
    for (const [count, width, height] of [
      [4, 374, 560],
      [4, 844, 300],
      [6, 1280, 700],
      [3, 280, 400],
    ] as const) {
      const gap = 8
      const layout = tileLayout(count, width, height, gap)
      expect(layout.columns * layout.tileWidth + gap * (layout.columns - 1)).toBeLessThanOrEqual(
        width,
      )
      expect(layout.rows * layout.tileHeight + gap * (layout.rows - 1)).toBeLessThanOrEqual(height)
    }
  })

  it('has nothing to lay out before the space has been measured', () => {
    expect(tileLayout(4, 0, 0)).toMatchObject({ tileWidth: 0, tileHeight: 0 })
  })
})
