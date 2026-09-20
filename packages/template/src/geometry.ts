import type { AvatarSize, BarPosition, CanvasShape, Rect, Room, UserArea } from './types.js'

/**
 * The geometry every other part of the product agrees on.
 *
 * The whole file exists to answer one question consistently: how big is an
 * avatar, as a fraction of the canvas? Everything else (what counts as a room
 * too small to use, where the bar sits, whether an area fits) falls out of that
 * answer, and it has to be the same answer in the builder, in the validator and
 * on the map, or an author draws a layout that the office then refuses.
 */

/**
 * The smallest viewport the office supports: a 1024x768 tablet.
 *
 * Minimum sizes are evaluated here rather than at some notional full size,
 * because a room that is legible on a desktop and unusable on a tablet is a
 * layout that passes validation and then disappoints someone.
 */
export const REFERENCE_VIEWPORT = { width: 1024, height: 768 } as const

/** Width divided by height, per shape. */
export const CANVAS_RATIO: Record<CanvasShape, number> = {
  landscape: 16 / 9,
  square: 1,
  portrait: 3 / 4,
}

/**
 * One avatar unit in pixels at the reference viewport: the avatar itself plus
 * the name label beneath it, plus the breathing room that keeps two of them from
 * touching.
 *
 * These three numbers are the engine's, not the template's. An author chooses
 * which of the three to use; they cannot invent a fourth, because every user
 * area on every template is a whole number of these.
 */
export const AVATAR_UNIT_PX: Record<AvatarSize, { width: number; height: number }> = {
  small: { width: 48, height: 64 },
  medium: { width: 64, height: 86 },
  large: { width: 88, height: 114 },
}

/**
 * The room's control bar, in pixels at the reference viewport.
 *
 * `height` is the action row only. The message row beneath it is collapsed when
 * there is nothing to say, so an ordinary open room does not carry a blank line,
 * and a room is not required to leave space for a row it usually will not draw.
 *
 * `minWidth` is what the bar needs before it stops being usable: a truncated
 * room name and the three controls at a tappable size.
 */
export const BAR_PX = { height: 32, minWidth: 168 } as const

/**
 * The canvas in pixels, fitted into the reference viewport.
 *
 * Letterboxed, never cropped: a room drawn at the edge of the canvas has to stay
 * on screen. This is why a minimum size is a different fraction of the canvas
 * for each shape — the same 168 pixels is a sixth of a landscape canvas and
 * nearly a third of a portrait one.
 */
export function canvasPixels(shape: CanvasShape): { width: number; height: number } {
  const ratio = CANVAS_RATIO[shape]
  const viewportRatio = REFERENCE_VIEWPORT.width / REFERENCE_VIEWPORT.height
  return ratio > viewportRatio
    ? { width: REFERENCE_VIEWPORT.width, height: REFERENCE_VIEWPORT.width / ratio }
    : { width: REFERENCE_VIEWPORT.height * ratio, height: REFERENCE_VIEWPORT.height }
}

/**
 * One avatar unit as a fraction of the canvas.
 *
 * This is the number a user area is counted in. It depends on both the shape and
 * the avatar size, which is exactly why changing either rescales the grid.
 */
export function avatarUnit(
  shape: CanvasShape,
  size: AvatarSize,
): { width: number; height: number } {
  const canvas = canvasPixels(shape)
  const unit = AVATAR_UNIT_PX[size]
  return { width: unit.width / canvas.width, height: unit.height / canvas.height }
}

/** The bar's height as a fraction of the canvas. */
export function barHeight(shape: CanvasShape): number {
  return BAR_PX.height / canvasPixels(shape).height
}

/**
 * The smallest a room may be: wide enough for its control bar, and tall enough
 * for the bar plus at least one avatar unit beneath it.
 *
 * A room that cannot show one person under a readable bar is not a room, it is a
 * decoration, and the author should be told while they are drawing rather than
 * when someone tries to walk in.
 */
export function minRoomSize(
  shape: CanvasShape,
  size: AvatarSize,
): { width: number; height: number } {
  const canvas = canvasPixels(shape)
  const unit = AVATAR_UNIT_PX[size]
  return {
    width: Math.max(BAR_PX.minWidth, unit.width) / canvas.width,
    height: (BAR_PX.height + unit.height) / canvas.height,
  }
}

/** Where the bar sits inside a room, as a rectangle in canvas coordinates. */
export function barRect(rect: Rect, bar: BarPosition, shape: CanvasShape): Rect {
  const height = Math.min(barHeight(shape), rect.height)
  return {
    x: rect.x,
    y: bar === 'top' ? rect.y : rect.y + rect.height - height,
    width: rect.width,
    height,
  }
}

/** The rectangle a user area occupies, from its corner and its cell counts. */
export function areaRect(
  area: UserArea,
  shape: CanvasShape,
  size: AvatarSize,
): Rect {
  const unit = avatarUnit(shape, size)
  return {
    x: area.x,
    y: area.y,
    width: area.columns * unit.width,
    height: area.rows * unit.height,
  }
}

/**
 * The tolerance for every geometry comparison.
 *
 * Normalized coordinates come from dividing pixels by a canvas size, so they
 * arrive with floating-point dust on them. Without a tolerance an area dropped
 * exactly against a wall fails for being 1e-16 outside it, which is the kind of
 * refusal that makes an author distrust the whole builder.
 */
export const EPSILON = 1e-6

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width - EPSILON &&
    b.x < a.x + a.width - EPSILON &&
    a.y < b.y + b.height - EPSILON &&
    b.y < a.y + a.height - EPSILON
  )
}

/** True when `inner` sits wholly within `outer`, touching edges allowed. */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x - EPSILON &&
    inner.y >= outer.y - EPSILON &&
    inner.x + inner.width <= outer.x + outer.width + EPSILON &&
    inner.y + inner.height <= outer.y + outer.height + EPSILON
  )
}

/** The unit canvas, for the "is this room on the canvas at all" check. */
export const CANVAS_RECT: Rect = { x: 0, y: 0, width: 1, height: 1 }

/**
 * Snap a point to the avatar grid, used by the builder while an area is dragged.
 *
 * The grid is anchored to the room rather than to the canvas, so areas in a room
 * line up with each other even when the room itself sits at an awkward offset.
 */
export function snapToUnits(
  value: number,
  origin: number,
  unit: number,
): number {
  return origin + Math.round((value - origin) / unit) * unit
}

/** How many whole units fit across a span. Never negative. */
export function unitsAcross(span: number, unit: number): number {
  return Math.max(0, Math.floor((span + EPSILON) / unit))
}

/**
 * The space inside a room that a user area may occupy: the room, less its bar.
 *
 * Areas may not overlap the bar, so this is the rectangle they have to fit in,
 * and it is what the builder snaps against.
 */
export function usableRect(room: Room, shape: CanvasShape): Rect {
  const bar = barRect(room.rect, room.bar, shape)
  return {
    x: room.rect.x,
    y: room.bar === 'top' ? room.rect.y + bar.height : room.rect.y,
    width: room.rect.width,
    height: room.rect.height - bar.height,
  }
}
