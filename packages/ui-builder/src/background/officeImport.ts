import {
  TemplateError,
  avatarUnit,
  centredArea,
  readOfficeSvg,
  usableRect,
  type OfficeSvgImport,
  type Template,
  type TemplateIssue,
} from '@unityevolv/ofiskit-template'

/**
 * What the builder makes of an uploaded SVG.
 *
 * Three outcomes, because three different things happen next. A picture is
 * drawn on, as every background always has been. An office arrives with its
 * rooms, and the rooms step opens already laid out. A refused file never
 * becomes a background at all: the importer found something that must not be
 * shown to the members of an office (a script, an embedded document, a link to
 * somewhere else), and that is said with the element named rather than fixed
 * quietly.
 *
 * Rule problems — two receptions, a room off the canvas, an area in the bar —
 * do not refuse the file. The rooms come in as they are and the builder shows
 * each problem where it is, which is how a hand-drawn mistake is shown too.
 */
export type ImportedOffice =
  | { kind: 'picture' }
  | { kind: 'refused'; issues: TemplateIssue[] }
  | {
      kind: 'office'
      template: Template
      found: { rooms: number; areas: number }
      /** Rule problems the rooms step will show on the rooms they belong to. */
      issues: TemplateIssue[]
      warnings: TemplateIssue[]
    }

/** The codes that make a file unusable as a background, whatever else it holds. */
const REFUSING: ReadonlySet<string> = new Set([
  TemplateError.SVG_UNSAFE,
  TemplateError.SVG_MALFORMED,
  TemplateError.SVG_CANVAS_MISMATCH,
])

export function importOfficeFile(source: string, imageName: string): ImportedOffice {
  const result: OfficeSvgImport = readOfficeSvg(source, { imageName })

  const refusing = result.issues.filter((entry) => REFUSING.has(entry.code))
  if (refusing.length > 0) return { kind: 'refused', issues: refusing }

  if (!result.marked || result.template === null) return { kind: 'picture' }

  return {
    kind: 'office',
    template: result.template,
    found: result.found,
    issues: result.issues,
    warnings: result.warnings,
  }
}

/** Tolerance when deciding two files carry the same rooms: floating-point dust only. */
const SAME = 1e-3

/**
 * The first room in `light` that `dark` does not carry at the same place, or
 * null when the two layouts agree.
 *
 * Matched by position rather than by name, because a dark export can be
 * renamed freely but must not move anything: the dark variant is a recolouring
 * of the same scene, never a different layout.
 */
export function firstMovedRoom(light: Template, dark: Template): string | null {
  if (light.rooms.length !== dark.rooms.length) {
    return light.rooms.length > dark.rooms.length
      ? (light.rooms.find((room) => !dark.rooms.some((other) => sameRect(room, other)))?.name ??
          null)
      : `${dark.rooms.length - light.rooms.length} extra`
  }
  for (const room of light.rooms) {
    if (!dark.rooms.some((other) => sameRect(room, other))) return room.name
  }
  return null
}

function sameRect(a: Template['rooms'][number], b: Template['rooms'][number]): boolean {
  return (
    Math.abs(a.rect.x - b.rect.x) < SAME &&
    Math.abs(a.rect.y - b.rect.y) < SAME &&
    Math.abs(a.rect.width - b.rect.width) < SAME &&
    Math.abs(a.rect.height - b.rect.height) < SAME
  )
}

/**
 * Give every room without a user area one, centred, the way a room drawn by
 * hand gets one. Two cells wide where the room allows it, one otherwise.
 */
export function fillAreas(template: Template): Template {
  const unit = avatarUnit(template.canvas, template.avatarSize)
  return {
    ...template,
    rooms: template.rooms.map((room) => {
      if (room.areas.length > 0) return room
      const usable = usableRect(room, template.canvas)
      const columns = usable.width >= 2 * unit.width ? 2 : 1
      return {
        ...room,
        areas: [centredArea(room, template.canvas, template.avatarSize, columns, 1)],
      }
    }),
  }
}

/**
 * How close to the canvas edge a room may sit before a festival frame covers
 * its bar: as a fraction of the canvas, the widest inset among the shipped
 * frames. A note, never a refusal: an org with frames off is not affected.
 */
export const FRAME_INSET = 0.02

export function edgeWarnings(template: Template): string[] {
  return template.rooms
    .filter(
      (room) =>
        room.rect.x < FRAME_INSET ||
        room.rect.y < FRAME_INSET ||
        room.rect.x + room.rect.width > 1 - FRAME_INSET ||
        room.rect.y + room.rect.height > 1 - FRAME_INSET,
    )
    .map(
      (room) =>
        `${room.name} touches the edge of the canvas, where a festival frame would cover its bar.`,
    )
}

/** One line for the author: what the picture brought with it. */
export function describeFound(found: { rooms: number; areas: number }): string {
  const rooms = `${found.rooms} room${found.rooms === 1 ? '' : 's'}`
  const areas = `${found.areas} user area${found.areas === 1 ? '' : 's'}`
  return `${rooms} and ${areas} found in the picture.`
}
