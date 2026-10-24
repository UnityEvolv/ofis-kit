import { TemplateError, issue, type TemplateIssue } from '../errors.js'
import { CANVAS_RATIO } from '../geometry.js'
import { newId } from '../id.js'
import {
  AVATAR_SIZES,
  BAR_POSITIONS,
  CANVAS_SHAPES,
  ROOM_TYPES,
  type AvatarSize,
  type BarPosition,
  type CanvasShape,
  type Rect,
  type Room,
  type RoomType,
  type Template,
  type UserArea,
} from '../types.js'
import { validateTemplate } from '../validate.js'
import { MAX_SVG_BYTES, checkSvgSafety } from './safety.js'
import { XmlParseError, parseXml, walk, type XmlElement } from './xml.js'

/**
 * Reading an office out of a structured SVG.
 *
 * A background picture used to be a picture and nothing more; the rooms were
 * drawn over it by hand in the builder, and nothing tied the two together. A
 * structured SVG carries its rooms as groups, so the importer reads them off and
 * the builder opens with the office already laid out. The convention is small on
 * purpose, so that a designer exporting from Figma and a language model writing
 * SVG from the published prompt produce the same thing:
 *
 *   <svg viewBox="0 0 1920 1080" data-ofis="1" data-canvas="landscape" data-avatar="small">
 *     <g id="backdrop">…</g>
 *     <g id="rooms">
 *       <g id="room-reception-Reception" data-bar="top">
 *         <rect x y width height …/>            first rect: the room's bounds
 *         …art…
 *         <rect id="area-4x1" x y … fill="none"/>  optional: a user area's origin
 *       </g>
 *     </g>
 *     <g id="overlay">…</g>
 *   </svg>
 *
 * A file without the markers is not an error. It is a picture, and the builder
 * takes the ordinary path: the author draws the rooms. `marked` says which.
 */

/** The convention's version, written on the root as `data-ofis`. */
export const OFFICE_SVG_VERSION = '1'

/** `room-<type>-<Name>`. Underscores in the name are spaces; Figma writes them that way. */
export const ROOM_ID = /^room-([a-z]+)-(.+)$/

/** `area-<columns>x<rows>`, with Figma's `_2` duplicate suffix tolerated. */
export const AREA_ID = /^area-(\d+)x(\d+)(?:_\d+)?$/

/**
 * How far a viewBox may be from a canvas ratio and still be that canvas.
 *
 * The same tolerance the builder applies to an uploaded raster, so the two
 * paths refuse the same files.
 */
const RATIO_TOLERANCE = 0.03

export interface OfficeSvgOptions {
  /** The file name the picture will have beside template.json. */
  imageName: string
  /** The template's name; the root's `data-name` wins when present. */
  name?: string
  /** For tests, which want stable ids. Production leaves it unset. */
  ids?: () => string
}

export interface OfficeSvgImport {
  /** True when the file carries room groups. False means: a picture, draw the rooms. */
  marked: boolean
  /** The canvas the picture fits, when it fits one. */
  canvas: CanvasShape | null
  /**
   * The office read from the file, rooms and areas prefilled. Present whenever
   * the file was marked and readable, even with issues outstanding, so the
   * builder can show each problem on the room it belongs to.
   */
  template: Template | null
  found: { rooms: number; areas: number }
  /** Everything that must be fixed before this can be an office. */
  issues: TemplateIssue[]
  /** Worth telling the author; not a reason to refuse. */
  warnings: TemplateIssue[]
}

interface ViewBox {
  x: number
  y: number
  width: number
  height: number
}

const number = (value: string | undefined): number | null => {
  if (value === undefined) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

function readViewBox(root: XmlElement): ViewBox | null {
  const raw = root.attributes['viewBox']
  if (raw !== undefined) {
    const parts = raw
      .trim()
      .split(/[\s,]+/)
      .map(Number)
    const [x, y, width, height] = parts
    if (
      parts.length === 4 &&
      parts.every(Number.isFinite) &&
      (width ?? 0) > 0 &&
      (height ?? 0) > 0
    ) {
      return { x: x ?? 0, y: y ?? 0, width: width ?? 0, height: height ?? 0 }
    }
    return null
  }
  const width = number(root.attributes['width'])
  const height = number(root.attributes['height'])
  if (width !== null && height !== null && width > 0 && height > 0) {
    return { x: 0, y: 0, width, height }
  }
  return null
}

/** The canvas shape a picture of this ratio is, or null when it is none of them. */
export function canvasForRatio(ratio: number): CanvasShape | null {
  let best: CanvasShape | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const shape of CANVAS_SHAPES) {
    const distance = Math.abs(ratio - CANVAS_RATIO[shape]) / CANVAS_RATIO[shape]
    if (distance < bestDistance) {
      best = shape
      bestDistance = distance
    }
  }
  return bestDistance <= RATIO_TOLERANCE ? best : null
}

function readRect(element: XmlElement): Rect | null {
  const x = number(element.attributes['x']) ?? 0
  const y = number(element.attributes['y']) ?? 0
  const width = number(element.attributes['width'])
  const height = number(element.attributes['height'])
  if (width === null || height === null || width <= 0 || height <= 0) return null
  return { x, y, width, height }
}

/** True when a rect would show in the picture. Area markers must not. */
function isVisible(element: XmlElement): boolean {
  const fill = element.attributes['fill']?.trim().toLowerCase()
  const stroke = element.attributes['stroke']?.trim().toLowerCase()
  const opacity = number(element.attributes['opacity'])
  const fillOpacity = number(element.attributes['fill-opacity'])
  if (opacity === 0) return false
  const paintsFill = fill !== 'none' && fill !== 'transparent' && fillOpacity !== 0
  const paintsStroke = stroke !== undefined && stroke !== 'none' && stroke !== 'transparent'
  return paintsFill || paintsStroke
}

/**
 * Read an office SVG.
 *
 * Returns rather than throws, in the validator's style: every problem at once,
 * each with a line number, because the author is going to paste the list back
 * to whoever or whatever drew the file.
 */
export function readOfficeSvg(source: string, options: OfficeSvgOptions): OfficeSvgImport {
  const issues: TemplateIssue[] = []
  const warnings: TemplateIssue[] = []
  const makeId = options.ids ?? newId
  const empty = (canvas: CanvasShape | null): OfficeSvgImport => ({
    marked: false,
    canvas,
    template: null,
    found: { rooms: 0, areas: 0 },
    issues,
    warnings,
  })

  if (source.length > MAX_SVG_BYTES) {
    issues.push(
      issue(
        TemplateError.SVG_MALFORMED,
        'svg',
        `The file is ${Math.round(source.length / 1024)} KB; an office picture is at most ${Math.round(MAX_SVG_BYTES / 1024)} KB.`,
      ),
    )
    return empty(null)
  }

  let root: XmlElement
  try {
    root = parseXml(source)
  } catch (cause) {
    const line = cause instanceof XmlParseError ? cause.line : 0
    issues.push(
      issue(
        TemplateError.SVG_MALFORMED,
        `svg:line ${line}`,
        `That is not well-formed SVG: ${cause instanceof Error ? cause.message : 'unreadable'}`,
      ),
    )
    return empty(null)
  }

  if (root.name !== 'svg') {
    issues.push(
      issue(TemplateError.SVG_MALFORMED, 'svg', `The root element is <${root.name}>, not <svg>.`),
    )
    return empty(null)
  }

  issues.push(...checkSvgSafety(root))

  const viewBox = readViewBox(root)
  if (viewBox === null) {
    issues.push(
      issue(
        TemplateError.SVG_MALFORMED,
        'svg',
        'The <svg> needs a viewBox (or a width and height) so rooms can be placed against it.',
      ),
    )
    return empty(null)
  }

  const detected = canvasForRatio(viewBox.width / viewBox.height)
  const declared = root.attributes['data-canvas']
  let canvas: CanvasShape | null = detected
  if (detected === null) {
    issues.push(
      issue(
        TemplateError.SVG_CANVAS_MISMATCH,
        'svg',
        `The picture is ${viewBox.width}x${viewBox.height}, which is not 16:9, 1:1 or 3:4. Rooms would sit slightly wrong against it.`,
      ),
    )
  }
  if (declared !== undefined) {
    if (!CANVAS_SHAPES.includes(declared as CanvasShape)) {
      issues.push(
        issue(
          TemplateError.SVG_CANVAS_MISMATCH,
          'svg',
          `data-canvas is "${declared}"; a canvas is one of: ${CANVAS_SHAPES.join(', ')}.`,
        ),
      )
    } else if (detected !== null && declared !== detected) {
      issues.push(
        issue(
          TemplateError.SVG_CANVAS_MISMATCH,
          'svg',
          `data-canvas says ${declared} but the viewBox is ${detected}.`,
        ),
      )
      canvas = null
    }
  }

  // Rooms are found wherever they are, not only under #rooms. Figma nests things
  // one level deeper when a designer groups the groups, and insisting on the
  // exact depth would refuse a file that is otherwise perfectly readable.
  const roomGroups: XmlElement[] = []
  for (const [element] of walk(root)) {
    if (element.name === 'g' && ROOM_ID.test(element.attributes['id'] ?? '')) {
      roomGroups.push(element)
    }
  }

  if (roomGroups.length === 0) {
    if (root.attributes['data-ofis'] !== undefined) {
      warnings.push(
        issue(
          TemplateError.SVG_ROOM_MISSING,
          'svg',
          'The file says it is an office (data-ofis) but has no room-… groups, so it is treated as a plain picture.',
        ),
      )
    }
    return empty(canvas)
  }

  // From here on the file is an office, and the remaining rules are the office's.
  for (const [element] of walk(root)) {
    if (element.name === 'text' || element.name === 'tspan' || element.name === 'textPath') {
      issues.push(
        issue(
          TemplateError.SVG_TEXT,
          `svg:line ${element.line}`,
          `There is lettering in the picture ("${element.text.slice(0, 40)}"). Room names are drawn by the product; remove every <text>.`,
        ),
      )
      break
    }
  }

  const avatarRaw = root.attributes['data-avatar']
  let avatarSize: AvatarSize = 'medium'
  if (avatarRaw === undefined) {
    warnings.push(
      issue(
        TemplateError.SVG_AVATAR_SIZE_MISSING,
        'svg',
        'No data-avatar on the <svg>; medium is assumed. Set small, medium or large to match the drawing.',
      ),
    )
  } else if (AVATAR_SIZES.includes(avatarRaw as AvatarSize)) {
    avatarSize = avatarRaw as AvatarSize
  } else {
    issues.push(
      issue(
        TemplateError.AVATAR_SIZE_UNKNOWN,
        'svg',
        `data-avatar is "${avatarRaw}"; an avatar size is one of: ${AVATAR_SIZES.join(', ')}.`,
      ),
    )
  }

  const normalise = (rect: Rect): Rect => ({
    x: (rect.x - viewBox.x) / viewBox.width,
    y: (rect.y - viewBox.y) / viewBox.height,
    width: rect.width / viewBox.width,
    height: rect.height / viewBox.height,
  })

  const rooms: Room[] = []
  let areasFound = 0

  for (const group of roomGroups) {
    const id = group.attributes['id'] ?? ''
    const match = ROOM_ID.exec(id)
    if (match === null) continue
    const [, typeRaw, nameRaw] = match
    const path = `svg:#${id}`

    const type = typeRaw as RoomType
    if (!ROOM_TYPES.includes(type)) {
      issues.push(
        issue(
          TemplateError.ROOM_TYPE_UNKNOWN,
          path,
          `"${id}" names a room type "${typeRaw}". A room is one of: ${ROOM_TYPES.join(', ')}.`,
        ),
      )
      continue
    }

    const name = (nameRaw ?? '').replace(/_/g, ' ').trim()
    if (name.length === 0) {
      issues.push(issue(TemplateError.ROOM_NAME_EMPTY, path, `"${id}" gives the room no name.`))
      continue
    }

    const barRaw = group.attributes['data-bar']
    let bar: BarPosition = 'top'
    if (barRaw !== undefined) {
      if (BAR_POSITIONS.includes(barRaw as BarPosition)) bar = barRaw as BarPosition
      else {
        issues.push(
          issue(
            TemplateError.ROOM_BAR_UNKNOWN,
            path,
            `${name}: data-bar is "${barRaw}"; the control bar sits at the top or the bottom.`,
          ),
        )
      }
    }

    const boundsElement = group.children.find((child) => child.name === 'rect')
    const bounds = boundsElement === undefined ? null : readRect(boundsElement)
    if (bounds === null) {
      issues.push(
        issue(
          TemplateError.SVG_ROOM_BOUNDS_MISSING,
          path,
          `${name} (line ${group.line}) has no bounds. The first <rect> inside a room group is its outline; give it x, y, width and height.`,
        ),
      )
      continue
    }

    const areas: UserArea[] = []
    for (const child of group.children) {
      if (child.name !== 'rect') continue
      const areaMatch = AREA_ID.exec(child.attributes['id'] ?? '')
      if (areaMatch === null) continue
      const columns = Number.parseInt(areaMatch[1] ?? '0', 10)
      const rows = Number.parseInt(areaMatch[2] ?? '0', 10)
      const origin = readRect(child) ?? {
        x: number(child.attributes['x']) ?? 0,
        y: number(child.attributes['y']) ?? 0,
        width: 1,
        height: 1,
      }
      if (isVisible(child)) {
        warnings.push(
          issue(
            TemplateError.SVG_AREA_VISIBLE,
            `${path} area`,
            `The ${columns}x${rows} area marker in ${name} (line ${child.line}) is visible. Give it fill="none" so it does not show in the office.`,
          ),
        )
      }
      const normalised = normalise(origin)
      areas.push({ id: makeId(), x: normalised.x, y: normalised.y, columns, rows })
      areasFound += 1
    }

    rooms.push({ id: makeId(), name, type, rect: normalise(bounds), bar, areas })
  }

  const draft: Template = {
    version: 1,
    name: root.attributes['data-name']?.trim() || options.name || 'Imported office',
    canvas: canvas ?? 'landscape',
    avatarSize,
    images: { light: options.imageName },
    rooms,
  }

  // The ordinary validator has the last word on geometry, so a room read from a
  // file is held to exactly the rules a room drawn in the builder is.
  if (canvas !== null) {
    const validated = validateTemplate(draft)
    if (!validated.ok) issues.push(...validated.issues)
  }

  return {
    marked: true,
    canvas,
    template: draft,
    found: { rooms: rooms.length, areas: areasFound },
    issues,
    warnings,
  }
}
