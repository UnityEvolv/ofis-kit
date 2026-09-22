import {
  avatarUnit,
  usableRect,
  type Rect,
  type Room,
  type Template,
  type UserArea,
} from '@unityevolv/ofiskit-template'

/**
 * The rules a drawing tool is made of, with no React in them.
 *
 * Everything here takes a template and returns a template, or answers a question
 * about one. That is the whole point of the file: what a drag *means* — where a
 * room may sit, how close is close enough to snap, what happens to a room's user
 * areas when the room moves — is the part worth being sure about, and none of it
 * needs a pointer, an element or a rendered component to be true.
 *
 * The component above turns events into calls to these; it decides nothing.
 */

/** Rooms snap to this fraction of the canvas, and to other rooms' edges. */
export const GRID = 0.01
export const SNAP_TO_EDGE = 0.012

/** A room has to be at least this big to be a room somebody meant to draw. */
export const MIN_DRAWN = 0.03

/** Half a pixel at any sane canvas size: enough to forgive a rounded edge. */
const EPSILON = 0.0005

export const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), high)

export type Unit = { width: number; height: number }

export type Direction = { x: number; y: number }

/**
 * Snap a room edge to the grid, or to another room's edge if one is close.
 *
 * Edges win over the grid: lining up with the room next door is what the author
 * is actually trying to do, and the grid is only there so that a room with
 * nothing near it still lands somewhere tidy. The second value is the edge it
 * snapped to, or null — which is what the alignment guide draws.
 */
export function snapRoom(
  template: Template,
  value: number,
  axis: 'x' | 'y',
  ignoreId?: string,
): [number, number | null] {
  for (const room of template.rooms) {
    if (room.id === ignoreId) continue
    const edges =
      axis === 'x'
        ? [room.rect.x, room.rect.x + room.rect.width]
        : [room.rect.y, room.rect.y + room.rect.height]
    for (const edge of edges) {
      if (Math.abs(edge - value) < SNAP_TO_EDGE) return [edge, edge]
    }
  }
  return [Math.round(value / GRID) * GRID, null]
}

/**
 * Where a user area lands.
 *
 * Its **size** is whole avatar units and always will be: half an avatar is not a
 * place anybody can stand. Its **position** is not, and the two were once
 * conflated. An area holding two people holds exactly two wherever it sits, so
 * snapping its corner to a lattice of whole avatars buys nothing — and it costs a
 * great deal, because one avatar unit is about a sixth of the height of a
 * landscape office, which leaves a typical room with two or three places an area
 * can be at all. It reads as a broken drag rather than as a rule.
 *
 * So the corner snaps to the same fine grid as everything else, and the area is
 * kept inside the room it belongs to — an area outside its room is not somewhere
 * a person can be put, and it used to be reported afterwards as a validation
 * warning instead of being prevented.
 */
export function placeArea(
  wanted: { x: number; y: number },
  area: { columns: number; rows: number },
  usable: Rect,
  unit: Unit,
): { x: number; y: number } {
  const width = area.columns * unit.width
  const height = area.rows * unit.height

  return {
    // `Math.max` on the far edge because a room can be resized smaller than an
    // area already in it, and a clamp with its ends crossed returns nonsense.
    x: clamp(
      Math.round(wanted.x / GRID) * GRID,
      usable.x,
      Math.max(usable.x, usable.x + usable.width - width),
    ),
    y: clamp(
      Math.round(wanted.y / GRID) * GRID,
      usable.y,
      Math.max(usable.y, usable.y + usable.height - height),
    ),
  }
}

// ------------------------------------------------------------------ hit tests

export function roomAt(template: Template, at: { x: number; y: number }): Room | null {
  // Reverse order so the most recently added room wins where they overlap,
  // which is what the author just drew and therefore what they mean.
  for (let index = template.rooms.length - 1; index >= 0; index -= 1) {
    const room = template.rooms[index]
    if (!room) continue
    const { x, y, width, height } = room.rect
    if (at.x >= x - EPSILON && at.x <= x + width && at.y >= y - EPSILON && at.y <= y + height) {
      return room
    }
  }
  return null
}

export function areaAt(
  template: Template,
  at: { x: number; y: number },
): { room: Room; area: UserArea } | null {
  const unit = avatarUnit(template.canvas, template.avatarSize)
  for (const room of template.rooms) {
    for (const area of room.areas) {
      const width = area.columns * unit.width
      const height = area.rows * unit.height
      if (at.x >= area.x && at.x <= area.x + width && at.y >= area.y && at.y <= area.y + height) {
        return { room, area }
      }
    }
  }
  return null
}

/** Whether a point is on a room's resize corner rather than on the room. */
export function onResizeCorner(room: Room, at: { x: number; y: number }): boolean {
  return (
    Math.abs(at.x - (room.rect.x + room.rect.width)) < 0.015 &&
    Math.abs(at.y - (room.rect.y + room.rect.height)) < 0.015
  )
}

// ----------------------------------------------------------------- transforms

export function mapRoom(
  template: Template,
  roomId: string,
  change: (room: Room) => Room,
): Template {
  return {
    ...template,
    rooms: template.rooms.map((room) => (room.id === roomId ? change(room) : room)),
  }
}

/**
 * Move a room, and take its user areas with it.
 *
 * The areas are the reason this is a function rather than two lines at the call
 * site: leaving them behind puts every one of them outside its room, which is a
 * validation error the author did not ask for and would have to undo by hand.
 */
export function moveRoom(
  template: Template,
  roomId: string,
  to: { x: number; y: number },
): Template {
  return mapRoom(template, roomId, (room) => {
    const x = clamp(to.x, 0, 1 - room.rect.width)
    const y = clamp(to.y, 0, 1 - room.rect.height)

    return {
      ...room,
      rect: { ...room.rect, x, y },
      areas: room.areas.map((area) => ({
        ...area,
        x: area.x + x - room.rect.x,
        y: area.y + y - room.rect.y,
      })),
    }
  })
}

/** Resize a room by dragging its bottom-right corner to a point. */
export function resizeRoom(
  template: Template,
  roomId: string,
  corner: { x: number; y: number },
  unit: Unit,
): Template {
  return mapRoom(template, roomId, (room) => ({
    ...room,
    rect: {
      ...room.rect,
      width: clamp(corner.x - room.rect.x, unit.width, 1 - room.rect.x),
      height: clamp(corner.y - room.rect.y, unit.height, 1 - room.rect.y),
    },
  }))
}

/** Move one user area within its room. */
export function moveArea(
  template: Template,
  roomId: string,
  areaId: string,
  wanted: { x: number; y: number },
  unit: Unit,
): Template {
  const room = template.rooms.find((candidate) => candidate.id === roomId)
  if (!room) return template
  const usable = usableRect(room, template.canvas)

  return mapRoom(template, roomId, (current) => ({
    ...current,
    areas: current.areas.map((area) =>
      area.id === areaId ? { ...area, ...placeArea(wanted, area, usable, unit) } : area,
    ),
  }))
}

/** Add a user area to a room, sized in whole cells. */
export function addArea(
  template: Template,
  roomId: string,
  rect: Rect,
  unit: Unit,
  id = `area-${Date.now().toString(36)}`,
): Template {
  const columns = Math.max(1, Math.round(rect.width / unit.width))
  const rows = Math.max(1, Math.round(rect.height / unit.height))

  return mapRoom(template, roomId, (room) => ({
    ...room,
    areas: [...room.areas, { id, x: rect.x, y: rect.y, columns, rows }],
  }))
}

/** A new room opens with the bar at the top and one 1x1 area, ready to adjust. */
export function addRoom(
  template: Template,
  rect: Rect,
  unit: Unit,
  id = `room-${Date.now().toString(36)}`,
): Template {
  const used = template.rooms.filter((room) => room.type === 'workspace' || room.type === 'meeting')

  return {
    ...template,
    rooms: [
      ...template.rooms,
      {
        id,
        name: `Room ${used.length + 1}`,
        type: 'workspace',
        rect,
        bar: 'top',
        areas: [
          {
            id: `area-${id}`,
            x: rect.x + (rect.width - unit.width) / 2,
            y: rect.y + (rect.height - unit.height) / 2,
            columns: 1,
            rows: 1,
          },
        ],
      },
    ],
  }
}

// ------------------------------------------------------------------- keyboard

/**
 * Nudge a room, or resize it.
 *
 * The keyboard half of the tool, and not a courtesy: an author who can select a
 * room from the panel but cannot then move it has a tool they cannot use.
 */
export function nudgeRoom(
  template: Template,
  roomId: string,
  direction: Direction,
  step: number,
  options: { resize?: boolean } = {},
): Template {
  const dx = direction.x * step
  const dy = direction.y * step

  if (options.resize) {
    return mapRoom(template, roomId, (room) => ({
      ...room,
      rect: {
        ...room.rect,
        width: clamp(room.rect.width + dx, GRID * 4, 1 - room.rect.x),
        height: clamp(room.rect.height + dy, GRID * 4, 1 - room.rect.y),
      },
    }))
  }

  const room = template.rooms.find((candidate) => candidate.id === roomId)
  if (!room) return template
  return moveRoom(template, roomId, { x: room.rect.x + dx, y: room.rect.y + dy })
}

/** Nudge one user area, on the grid and never out of its room. */
export function nudgeArea(
  template: Template,
  roomId: string,
  areaId: string,
  direction: Direction,
  step: number,
  unit: Unit,
): Template {
  const area = template.rooms
    .find((candidate) => candidate.id === roomId)
    ?.areas.find((candidate) => candidate.id === areaId)
  if (!area) return template

  return moveArea(
    template,
    roomId,
    areaId,
    { x: area.x + direction.x * step, y: area.y + direction.y * step },
    unit,
  )
}
