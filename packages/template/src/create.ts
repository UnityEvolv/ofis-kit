import { avatarUnit, usableRect } from './geometry.js'
import { newId } from './id.js'
import type { AvatarSize, CanvasShape, Rect, Room, RoomType, Template, UserArea } from './types.js'

/**
 * Where a new template starts, and what happens when the avatar size changes.
 *
 * A template arrives with a reception, a break room and one workspace already
 * placed. That is not a convenience: it makes the composition rules structural
 * rather than a validation step. A template can never be short of a reception,
 * so there is nothing to refuse mid-edit and nothing to explain on save. The
 * three can be moved, resized and renamed; they cannot be deleted.
 */

/**
 * The seed layout per canvas shape, in normalized coordinates.
 *
 * Chosen so that the largest avatar size still fits a 2x1 user area in every
 * seeded room, on every shape. There is a test that checks exactly that, because
 * the alternative is a new template that fails its own validator.
 */
const SEED_LAYOUT: Record<CanvasShape, Record<'reception' | 'break' | 'workspace', Rect>> = {
  landscape: {
    workspace: { x: 0.22, y: 0.1, width: 0.56, height: 0.38 },
    reception: { x: 0.04, y: 0.6, width: 0.28, height: 0.32 },
    break: { x: 0.68, y: 0.6, width: 0.28, height: 0.32 },
  },
  square: {
    workspace: { x: 0.15, y: 0.1, width: 0.7, height: 0.38 },
    reception: { x: 0.05, y: 0.62, width: 0.34, height: 0.3 },
    break: { x: 0.61, y: 0.62, width: 0.34, height: 0.3 },
  },
  portrait: {
    workspace: { x: 0.1, y: 0.12, width: 0.8, height: 0.4 },
    reception: { x: 0.06, y: 0.7, width: 0.4, height: 0.24 },
    break: { x: 0.54, y: 0.7, width: 0.4, height: 0.24 },
  },
}

/** The names a seeded room gets. Renameable; these are only a starting point. */
const SEED_NAMES: Record<'reception' | 'break' | 'workspace', string> = {
  reception: 'Reception',
  break: 'Break room',
  workspace: 'Workspace',
}

/**
 * Centre a user area of the given cell counts inside a room.
 *
 * Centred rather than cornered because the author is about to move it anyway,
 * and a slot in the middle of the room reads as a starting point while one
 * jammed into a corner reads as a mistake.
 */
export function centredArea(
  room: Room,
  shape: CanvasShape,
  size: AvatarSize,
  columns: number,
  rows: number,
  id: string = newId(),
): UserArea {
  const unit = avatarUnit(shape, size)
  const usable = usableRect(room, shape)
  const width = columns * unit.width
  const height = rows * unit.height
  return {
    id,
    x: usable.x + (usable.width - width) / 2,
    y: usable.y + (usable.height - height) / 2,
    columns,
    rows,
  }
}

export interface CreateTemplateOptions {
  name: string
  canvas: CanvasShape
  /** Medium suits most pictures, so it is the default. */
  avatarSize?: AvatarSize
  description?: string
  /**
   * The background images. A template is valid without them in the builder,
   * where the author picks the image first; a template read by a server is not.
   */
  images?: { light: string; dark?: string }
}

/**
 * A new template: three rooms, placed for the shape, each with a 2x1 user area.
 *
 * The bar sits at the top of every seeded room. The author moves it where the
 * picture needs it, which is a per-room choice precisely because a background
 * image has something in a different place in every room.
 */
export function createTemplate(options: CreateTemplateOptions): Template {
  const { name, canvas, avatarSize = 'medium', description, images } = options
  const layout = SEED_LAYOUT[canvas]

  // Reception first, because it is where people arrive, and the order here is
  // the order a screen reader reads the room list in.
  const order: Array<'reception' | 'break' | 'workspace'> = ['reception', 'workspace', 'break']

  const rooms = order.map<Room>((kind) => {
    const room: Room = {
      id: newId(),
      name: SEED_NAMES[kind],
      type: kind as RoomType,
      rect: layout[kind],
      bar: 'top',
      areas: [],
    }
    room.areas = [centredArea(room, canvas, avatarSize, 2, 1)]
    return room
  })

  const template: Template = {
    version: 1,
    name,
    canvas,
    avatarSize,
    images: images ?? { light: '' },
    rooms,
  }
  if (description !== undefined) template.description = description

  return template
}

/** A user area that no longer fits its room after an avatar size change. */
export interface UnfittedArea {
  roomId: string
  roomName: string
  areaId: string
  /** What it would have to shrink to in order to fit where it is. */
  fits: { columns: number; rows: number }
}

/**
 * Change the template's avatar size and rescale every user area's grid.
 *
 * The cell size is derived, never stored, so the areas keep their cell counts
 * and change size on screen. That is the desired behaviour: an author who says
 * "these avatars are too small" wants the 2x2 huddle to stay a 2x2 huddle.
 *
 * The cost is that a bigger unit can push an area out of its room. Rather than
 * silently shrinking it, which would lose the author's intent, this returns the
 * list of areas that no longer fit so the builder can show them with a
 * jump-to link and let the author decide.
 */
export function withAvatarSize(
  template: Template,
  avatarSize: AvatarSize,
): { template: Template; unfitted: UnfittedArea[] } {
  if (template.avatarSize === avatarSize) return { template, unfitted: [] }

  const unit = avatarUnit(template.canvas, avatarSize)
  const unfitted: UnfittedArea[] = []

  const rooms = template.rooms.map((room) => {
    const usable = usableRect(room, template.canvas)
    const areas = room.areas.map((area) => {
      // Keep the area's centre where the author put it, so the layout does not
      // jump; then pull it back inside the room if the new size pushed it out.
      const oldUnit = avatarUnit(template.canvas, template.avatarSize)
      const centreX = area.x + (area.columns * oldUnit.width) / 2
      const centreY = area.y + (area.rows * oldUnit.height) / 2
      const width = area.columns * unit.width
      const height = area.rows * unit.height

      const x = Math.min(Math.max(centreX - width / 2, usable.x), usable.x + usable.width - width)
      const y = Math.min(Math.max(centreY - height / 2, usable.y), usable.y + usable.height - height)

      if (width > usable.width || height > usable.height) {
        unfitted.push({
          roomId: room.id,
          roomName: room.name,
          areaId: area.id,
          fits: {
            columns: Math.max(1, Math.floor(usable.width / unit.width)),
            rows: Math.max(1, Math.floor(usable.height / unit.height)),
          },
        })
      }

      return { ...area, x, y }
    })
    return { ...room, areas }
  })

  return { template: { ...template, avatarSize, rooms }, unfitted }
}

/**
 * Add a room of a type that may be added.
 *
 * Reception and break room are absent from the signature on purpose: there is
 * exactly one of each and it is seeded, so "add a reception" is not a thing the
 * builder can offer and not a request this has to refuse.
 */
export function addRoom(
  template: Template,
  type: 'workspace' | 'meeting',
  rect: Rect,
  name: string,
): Template {
  const room: Room = { id: newId(), name, type, rect, bar: 'top', areas: [] }
  room.areas = [centredArea(room, template.canvas, template.avatarSize, 1, 1)]
  return { ...template, rooms: [...template.rooms, room] }
}
