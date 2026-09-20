import { CANVAS_RATIO, type CanvasShape, type Rect } from '@unityevolv/ofiskit-template'

/**
 * Turning the template's normalized geometry into pixels.
 *
 * Everything in a template is 0..1 against the canvas, so the layout holds at
 * any width. What changes per screen is where the canvas itself sits, and that
 * is the only thing this file works out.
 */

export interface CanvasBox {
  /** Offset of the canvas inside its container. */
  left: number
  top: number
  width: number
  height: number
}

/**
 * Fit the canvas into the space available, letterboxed rather than cropped.
 *
 * Cropping would be prettier on an awkward screen and is not an option: a room
 * drawn at the edge of the canvas would be cut off, and somebody would be
 * standing in a room nobody can click.
 */
export function fitCanvas(
  shape: CanvasShape,
  container: { width: number; height: number },
): CanvasBox {
  const ratio = CANVAS_RATIO[shape]
  if (container.width <= 0 || container.height <= 0) {
    return { left: 0, top: 0, width: 0, height: 0 }
  }

  const byWidth = container.width / ratio <= container.height
  const width = byWidth ? container.width : container.height * ratio
  const height = byWidth ? container.width / ratio : container.height

  return {
    left: (container.width - width) / 2,
    top: (container.height - height) / 2,
    width,
    height,
  }
}

/** A normalized rectangle, in pixels, positioned inside the canvas. */
export function toPixels(rect: Rect, canvas: CanvasBox) {
  return {
    left: canvas.left + rect.x * canvas.width,
    top: canvas.top + rect.y * canvas.height,
    width: rect.width * canvas.width,
    height: rect.height * canvas.height,
  }
}

/**
 * Where the call tiles go, which the canvas shape decides.
 *
 * A landscape office has width to spare and height at a premium, so the tiles
 * go across the top. A square or portrait one is the other way round, so they
 * go down the right. The author sees this in the builder preview, so the
 * decision is visible before anybody is in the room.
 */
export function tilePlacement(shape: CanvasShape): 'top' | 'right' {
  return shape === 'landscape' ? 'top' : 'right'
}

/**
 * Reading order for keyboard navigation.
 *
 * Left to right, top to bottom, as the canvas is drawn. Sorting by row first
 * with a tolerance stops two rooms whose tops differ by a pixel being read in
 * the wrong order, which is the difference between a tab order that makes sense
 * and one that jumps around the screen.
 */
export function readingOrder<T extends { rect: Rect }>(rooms: readonly T[]): T[] {
  const ROW_TOLERANCE = 0.08
  return [...rooms].sort((a, b) => {
    const sameRow = Math.abs(a.rect.y - b.rect.y) < ROW_TOLERANCE
    return sameRow ? a.rect.x - b.rect.x : a.rect.y - b.rect.y
  })
}

/**
 * The nearest room in a direction, for the arrow keys.
 *
 * Measured from centre to centre, only considering rooms that are genuinely in
 * that direction, and preferring ones that are close on the other axis too, so
 * pressing right moves to the room beside you rather than one diagonally across
 * the office that happens to be nearer.
 */
export function roomInDirection<T extends { rect: Rect }>(
  rooms: readonly T[],
  from: T,
  direction: 'left' | 'right' | 'up' | 'down',
): T | null {
  const centre = (rect: Rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })
  const origin = centre(from.rect)

  let best: T | null = null
  let bestScore = Number.POSITIVE_INFINITY

  for (const room of rooms) {
    if (room === from) continue
    const target = centre(room.rect)
    const dx = target.x - origin.x
    const dy = target.y - origin.y

    const goes =
      direction === 'left' ? dx < -0.001 : direction === 'right' ? dx > 0.001 : direction === 'up' ? dy < -0.001 : dy > 0.001
    if (!goes) continue

    // Distance along the direction, plus a penalty for drifting off to the
    // side. The penalty is what makes this feel like moving through a grid.
    const along = direction === 'left' || direction === 'right' ? Math.abs(dx) : Math.abs(dy)
    const across = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx)
    const score = along + across * 2

    if (score < bestScore) {
      bestScore = score
      best = room
    }
  }

  return best
}
