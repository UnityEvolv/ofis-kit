import {
  CANVAS_RECT,
  areaRect,
  barRect,
  minRoomSize,
  rectContains,
  rectsOverlap,
  usableRect,
} from './geometry.js'
import { TemplateError, issue, type TemplateIssue, type Validated } from './errors.js'
import {
  AVATAR_SIZES,
  BAR_POSITIONS,
  CANVAS_SHAPES,
  MAX_ROOMS,
  REQUIRED_ROOM_TYPES,
  ROOM_TYPES,
  type AvatarSize,
  type BarPosition,
  type CanvasShape,
  type Rect,
  type Room,
  type RoomType,
  type Template,
  type UserArea,
} from './types.js'

/**
 * The validator, run on the server and not only in the builder.
 *
 * The builder validates live so an author sees a problem while they are causing
 * it, but the builder is a client and a client can be bypassed. A template
 * arriving over the wire, or read off disk after someone edited it by hand, goes
 * through exactly this.
 *
 * It collects every problem rather than throwing on the first, because the
 * builder draws all of them at once and an author fixing five things one refusal
 * at a time gives up on the fourth.
 */

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/** A whole number of cells, and at least one. Half an avatar is not a slot. */
const isWholeCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1

function readRect(value: unknown, path: string, issues: TemplateIssue[]): Rect | null {
  if (!isObject(value)) {
    issues.push(issue(TemplateError.MALFORMED, path, 'A rectangle is required here.'))
    return null
  }
  const { x, y, width, height } = value
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) {
    issues.push(
      issue(TemplateError.MALFORMED, path, 'x, y, width and height must all be numbers.'),
    )
    return null
  }
  if (width <= 0 || height <= 0) {
    issues.push(issue(TemplateError.MALFORMED, path, 'A rectangle needs a positive size.'))
    return null
  }
  return { x, y, width, height }
}

function readArea(value: unknown, path: string, issues: TemplateIssue[]): UserArea | null {
  if (!isObject(value)) {
    issues.push(issue(TemplateError.MALFORMED, path, 'A user area is required here.'))
    return null
  }
  const { id, x, y, columns, rows } = value
  if (typeof id !== 'string' || id.length === 0) {
    issues.push(issue(TemplateError.MALFORMED, `${path}.id`, 'Every user area needs an id.'))
    return null
  }
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
    issues.push(issue(TemplateError.MALFORMED, path, 'A user area needs a position.'))
    return null
  }
  if (!isWholeCount(columns) || !isWholeCount(rows)) {
    issues.push(
      issue(
        TemplateError.AREA_FRACTIONAL,
        path,
        'A user area is a whole number of avatar cells on both axes, at least one of each.',
        { columns: String(columns), rows: String(rows) },
      ),
    )
    return null
  }
  return { id, x, y, columns, rows }
}

function readRoom(value: unknown, path: string, issues: TemplateIssue[]): Room | null {
  if (!isObject(value)) {
    issues.push(issue(TemplateError.MALFORMED, path, 'A room is required here.'))
    return null
  }
  const { id, name, type, bar, areas } = value

  if (typeof id !== 'string' || id.length === 0) {
    issues.push(issue(TemplateError.MALFORMED, `${path}.id`, 'Every room needs an id.'))
    return null
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    issues.push(issue(TemplateError.ROOM_NAME_EMPTY, `${path}.name`, 'Every room needs a name.'))
    return null
  }
  if (typeof type !== 'string' || !ROOM_TYPES.includes(type as RoomType)) {
    issues.push(
      issue(
        TemplateError.ROOM_TYPE_UNKNOWN,
        `${path}.type`,
        `A room is one of: ${ROOM_TYPES.join(', ')}.`,
      ),
    )
    return null
  }
  if (typeof bar !== 'string' || !BAR_POSITIONS.includes(bar as BarPosition)) {
    issues.push(
      issue(
        TemplateError.ROOM_BAR_UNKNOWN,
        `${path}.bar`,
        `The control bar sits at the ${BAR_POSITIONS.join(' or the ')} of a room.`,
      ),
    )
    return null
  }

  const rect = readRect(value.rect, `${path}.rect`, issues)
  if (rect === null) return null

  if (!Array.isArray(areas)) {
    issues.push(issue(TemplateError.MALFORMED, `${path}.areas`, 'A room needs a list of user areas.'))
    return null
  }

  const read: UserArea[] = []
  for (const [index, area] of areas.entries()) {
    const parsed = readArea(area, `${path}.areas[${index}]`, issues)
    if (parsed !== null) read.push(parsed)
  }

  return { id, name, type: type as RoomType, rect, bar: bar as BarPosition, areas: read }
}

/**
 * Check the geometry of one room and its areas.
 *
 * Split out because the builder calls it on every drag for the room being moved,
 * rather than revalidating the whole template thirty times a second.
 */
export function validateRoom(
  room: Room,
  others: readonly Room[],
  shape: CanvasShape,
  size: AvatarSize,
  path = 'rooms',
): TemplateIssue[] {
  const issues: TemplateIssue[] = []

  if (!rectContains(CANVAS_RECT, room.rect)) {
    issues.push(
      issue(
        TemplateError.ROOM_OUTSIDE_CANVAS,
        path,
        `${room.name} runs off the edge of the canvas.`,
      ),
    )
  }

  const minimum = minRoomSize(shape, size)
  if (room.rect.width + 1e-6 < minimum.width || room.rect.height + 1e-6 < minimum.height) {
    issues.push(
      issue(
        TemplateError.ROOM_TOO_SMALL,
        path,
        `${room.name} is too small to hold its control bar and one ${size} avatar beneath it on a tablet.`,
        {
          width: room.rect.width.toFixed(4),
          height: room.rect.height.toFixed(4),
          minWidth: minimum.width.toFixed(4),
          minHeight: minimum.height.toFixed(4),
        },
      ),
    )
  }

  for (const other of others) {
    if (other.id === room.id) continue
    if (rectsOverlap(room.rect, other.rect)) {
      issues.push(
        issue(
          TemplateError.ROOM_OVERLAP,
          path,
          `${room.name} overlaps ${other.name}. Rooms cannot share space.`,
        ),
      )
      // One message per room is enough; a room dragged across four others
      // should not produce four identical complaints.
      break
    }
  }

  // Areas must sit inside the room, clear of the bar, and clear of each other.
  const usable = usableRect(room, shape)
  const bar = barRect(room.rect, room.bar, shape)
  const rects = room.areas.map((area) => ({ area, rect: areaRect(area, shape, size) }))

  for (const [index, { area, rect }] of rects.entries()) {
    const areaPath = `${path}.areas[${index}]`

    if (rectsOverlap(rect, bar)) {
      issues.push(
        issue(
          TemplateError.AREA_OVERLAPS_BAR,
          areaPath,
          `A user area in ${room.name} sits under the room's control bar.`,
        ),
      )
    } else if (!rectContains(usable, rect)) {
      // Only worth saying when it is not already the bar's fault, so the author
      // gets one reason rather than two for the same misplacement.
      issues.push(
        issue(
          TemplateError.AREA_OUTSIDE_ROOM,
          areaPath,
          `A ${area.columns}x${area.rows} user area does not fit inside ${room.name}.`,
        ),
      )
    }

    for (const other of rects.slice(index + 1)) {
      if (rectsOverlap(rect, other.rect)) {
        issues.push(
          issue(
            TemplateError.AREA_OVERLAP,
            areaPath,
            `Two user areas in ${room.name} overlap. Avatars would be drawn on top of each other.`,
          ),
        )
        break
      }
    }
  }

  return issues
}

/**
 * Validate a whole template, structure and geometry together.
 *
 * Accepts `unknown` because the honest input is a JSON file someone may have
 * edited by hand, or a payload from a client. Nothing is trusted.
 */
export function validateTemplate(input: unknown): Validated<Template> {
  const issues: TemplateIssue[] = []

  if (!isObject(input)) {
    return { ok: false, issues: [issue(TemplateError.MALFORMED, '', 'A template must be an object.')] }
  }

  if (input.version !== 1) {
    issues.push(
      issue(
        TemplateError.MALFORMED,
        'version',
        'This is a version 1 template schema. Set "version": 1.',
      ),
    )
  }

  const name = typeof input.name === 'string' && input.name.trim().length > 0 ? input.name : null
  if (name === null) {
    issues.push(issue(TemplateError.MALFORMED, 'name', 'A template needs a name.'))
  }

  // Held as null until known good, rather than as a string that merely has the
  // right type. Geometry below divides by a canvas size looked up from these,
  // so "a string, but not one of the three" has to stop here and not there.
  let shape: CanvasShape | null = null
  if (typeof input.canvas === 'string' && CANVAS_SHAPES.includes(input.canvas as CanvasShape)) {
    shape = input.canvas as CanvasShape
  } else {
    issues.push(
      issue(
        TemplateError.CANVAS_UNKNOWN,
        'canvas',
        `A canvas is one of: ${CANVAS_SHAPES.join(', ')}.`,
      ),
    )
  }

  let size: AvatarSize | null = null
  if (
    typeof input.avatarSize === 'string' &&
    AVATAR_SIZES.includes(input.avatarSize as AvatarSize)
  ) {
    size = input.avatarSize as AvatarSize
  } else {
    issues.push(
      issue(
        TemplateError.AVATAR_SIZE_UNKNOWN,
        'avatarSize',
        `An avatar size is one of: ${AVATAR_SIZES.join(', ')}.`,
      ),
    )
  }

  const images = input.images
  let light: string | null = null
  let dark: string | undefined
  if (!isObject(images) || typeof images.light !== 'string' || images.light.length === 0) {
    issues.push(
      issue(
        TemplateError.IMAGE_MISSING,
        'images.light',
        'A template needs a light background image. The dark one is optional; when it is absent the light image is used in both themes.',
      ),
    )
  } else {
    light = images.light
    if (typeof images.dark === 'string' && images.dark.length > 0) dark = images.dark
  }

  if (!Array.isArray(input.rooms)) {
    issues.push(issue(TemplateError.MALFORMED, 'rooms', 'A template needs a list of rooms.'))
    return { ok: false, issues }
  }

  const rooms: Room[] = []
  for (const [index, room] of input.rooms.entries()) {
    const parsed = readRoom(room, `rooms[${index}]`, issues)
    if (parsed !== null) rooms.push(parsed)
  }

  // Without a canvas shape or an avatar size there is no grid to measure
  // against, so geometry is not checked and the author is told the one thing
  // that actually has to be fixed first.
  if (shape === null || size === null) return { ok: false, issues }

  if (rooms.length > MAX_ROOMS) {
    issues.push(
      issue(
        TemplateError.ROOMS_TOO_MANY,
        'rooms',
        `A template holds at most ${MAX_ROOMS} rooms; this one has ${rooms.length}. Past that a map stops being readable at a glance.`,
      ),
    )
  }

  // Names are how an office renames a room by reference, so duplicates make that
  // ambiguous. Compared case-insensitively and trimmed, because two rooms called
  // "Studio" and "studio " are the same mistake.
  const byName = new Map<string, Room[]>()
  for (const room of rooms) {
    const key = room.name.trim().toLocaleLowerCase()
    byName.set(key, [...(byName.get(key) ?? []), room])
  }
  for (const [, shared] of byName) {
    if (shared.length > 1) {
      const first = shared[0]
      if (first) {
        issues.push(
          issue(
            TemplateError.ROOM_NAME_DUPLICATE,
            'rooms',
            `More than one room is called ${first.name}. Room names must be unique within a template.`,
          ),
        )
      }
    }
  }

  for (const required of REQUIRED_ROOM_TYPES) {
    const found = rooms.filter((room) => room.type === required)
    if (found.length === 0) {
      issues.push(
        issue(
          TemplateError.ROOM_REQUIRED_MISSING,
          'rooms',
          `Every template has exactly one ${required === 'break' ? 'break room' : 'reception'}, and this one has none.`,
        ),
      )
    } else if (found.length > 1) {
      issues.push(
        issue(
          TemplateError.ROOM_REQUIRED_DUPLICATE,
          'rooms',
          `Every template has exactly one ${required === 'break' ? 'break room' : 'reception'}, and this one has ${found.length}.`,
        ),
      )
    }
  }

  for (const [index, room] of rooms.entries()) {
    issues.push(...validateRoom(room, rooms, shape, size, `rooms[${index}]`))
  }

  if (issues.length > 0) return { ok: false, issues }

  const template: Template = {
    version: 1,
    name: name as string,
    canvas: shape,
    avatarSize: size,
    images: dark === undefined ? { light: light as string } : { light: light as string, dark },
    rooms,
  }
  if (typeof input.description === 'string' && input.description.length > 0) {
    template.description = input.description
  }

  return { ok: true, value: template }
}

/**
 * Parse a template from the JSON a host read off disk or received.
 *
 * Kept separate from `validateTemplate` so a malformed file reports as a bad
 * file rather than as thirty missing fields.
 */
export function parseTemplate(json: string): Validated<Template> {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (cause) {
    return {
      ok: false,
      issues: [
        issue(
          TemplateError.MALFORMED,
          '',
          `That is not valid JSON: ${cause instanceof Error ? cause.message : 'unparseable'}`,
        ),
      ],
    }
  }
  return validateTemplate(parsed)
}
