/**
 * The office layout, as data.
 *
 * A template is the layout and nothing else: a background image, rooms, and the
 * geometry that places them. Offices are thin instances over it, which is why
 * capacity is deliberately absent here — the same template serves a two-person
 * team and a forty-person one, and capacity belongs to the office.
 *
 * Everything positional is normalized to 0..1 against the canvas, so a layout
 * holds at any width without anyone storing pixels.
 */

/**
 * The three canvas shapes.
 *
 * Fixed once a template is created, because every room is placed relative to it.
 * Portrait is 3:4 rather than 9:16 on purpose: a 9:16 map beside a column of
 * call tiles leaves most of a landscape monitor empty.
 *
 * The shape also decides where the call tiles go in the office view: across the
 * top for landscape, in a column on the right for square and portrait.
 */
export type CanvasShape = 'landscape' | 'square' | 'portrait'

/**
 * How big an avatar is drawn, chosen by the author to suit the picture.
 *
 * A dense floor plan with many small rooms wants small; a cutaway with big rooms
 * wants large. It sets the avatar unit for the whole template, so changing it
 * rescales every user area's grid.
 */
export type AvatarSize = 'small' | 'medium' | 'large'

/**
 * What a room is for.
 *
 * `reception` and `break` have real rules: no calls, uncapped, and exactly one
 * of each per template. `workspace` and `meeting` behave identically for now and
 * the type is a label and an icon that tells people what a room is for. Both
 * exist so that giving them different behaviour later is not a migration.
 */
export type RoomType = 'reception' | 'break' | 'workspace' | 'meeting'

/**
 * Which edge of the room its control bar sits on.
 *
 * Chosen per room so the bar can be kept clear of whatever the background image
 * has in that spot. Room names are drawn on this bar by the product and are
 * never part of the image.
 */
export type BarPosition = 'top' | 'bottom'

/** A rectangle in normalized canvas coordinates. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * A display slot for people in a room, measured in whole avatar units.
 *
 * Not seats. Capacity is an office setting and is independent: a room can hold
 * more people than it has cells, and the map puts the overflow in a counter in
 * the last cell.
 *
 * Only the top-left corner and the cell counts are stored. The cell size is
 * derived from the template's avatar size, so it is never stored per area and
 * changing the avatar size rescales every area at once.
 */
export interface UserArea {
  id: string
  /** Top-left corner, normalized against the canvas. */
  x: number
  y: number
  /** Whole avatar units. A fractional count is a validation failure. */
  columns: number
  rows: number
}

export interface Room {
  id: string
  /** Unique within the template: offices rename rooms by reference. */
  name: string
  type: RoomType
  rect: Rect
  bar: BarPosition
  areas: UserArea[]
}

/**
 * Both images share one set of room coordinates.
 *
 * The dark variant is a recolouring of the same scene, never a different layout.
 * The builder enforces that by having one geometry with two image slots, and
 * theme is a per-user setting, so two people in the same room may be looking at
 * different images over identical geometry.
 */
export interface TemplateImages {
  /** Required. Used in dark mode too when there is no dark variant. */
  light: string
  dark?: string
}

export interface Template {
  /** Schema version, so a stored template can be migrated rather than guessed at. */
  version: 1
  name: string
  description?: string
  canvas: CanvasShape
  avatarSize: AvatarSize
  images: TemplateImages
  rooms: Room[]
}

/** The three rooms a template always has, and which of them may not be deleted. */
export const REQUIRED_ROOM_TYPES: readonly RoomType[] = ['reception', 'break']

/** Rooms that never host a call, whatever the provider. */
export const ROOMS_WITHOUT_CALLS: readonly RoomType[] = ['reception', 'break']

/**
 * The ceiling on rooms per template.
 *
 * Not a technical limit. Past thirty rooms a map stops being something a person
 * can read at a glance, which is the only reason to draw an office as a picture.
 */
export const MAX_ROOMS = 30

export const CANVAS_SHAPES: readonly CanvasShape[] = ['landscape', 'square', 'portrait']
export const AVATAR_SIZES: readonly AvatarSize[] = ['small', 'medium', 'large']
export const ROOM_TYPES: readonly RoomType[] = ['reception', 'break', 'workspace', 'meeting']
export const BAR_POSITIONS: readonly BarPosition[] = ['top', 'bottom']

/** True when this room type never hosts a call. */
export function hostsCalls(type: RoomType): boolean {
  return !ROOMS_WITHOUT_CALLS.includes(type)
}

/** True when this room type may not be deleted from a template. */
export function isRequired(type: RoomType): boolean {
  return REQUIRED_ROOM_TYPES.includes(type)
}
