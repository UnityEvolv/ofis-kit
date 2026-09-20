/**
 * One error envelope, for the whole engine.
 *
 * It lives in this package because this is the lowest one: everything else
 * depends on the template, so putting the envelope here lets every layer share
 * one shape without a dependency cycle. `adapters` and `realtime-core`
 * re-export it, so nothing has to import the template package to report an error.
 *
 * The rule that makes it useful: the `code` is stable and documented and is what
 * a client branches on; the `message` is for a person to read and is never
 * parsed. A refusal a client cannot tell apart from another refusal is a bug in
 * the contract, not in the client.
 */
export interface ErrorEnvelope {
  /** Stable, documented, and permanent. Clients branch on this. */
  code: string
  /** Safe to show to whoever is looking at the screen. Never parsed. */
  message: string
  /** Field-level detail for a validation failure, keyed by path. */
  fields?: Record<string, string>
}

/**
 * A template problem, which is an envelope that also says where.
 *
 * `path` is a JSON pointer-ish path into the template (`rooms[2].areas[0]`), so
 * the builder can jump straight to the thing that is wrong instead of making the
 * author hunt for it.
 */
export interface TemplateIssue extends ErrorEnvelope {
  path: string
}

/**
 * Every way a template can be wrong.
 *
 * Grouped by what the author did, because the builder shows these next to the
 * thing they are about and the wording has to work in that position. They are
 * `template.*` so they do not collide with the core's refusal codes.
 */
export const TemplateError = {
  /** The document itself is not a template: wrong type, missing field, bad enum. */
  MALFORMED: 'template.malformed',
  /** A canvas shape that is not one of the three. */
  CANVAS_UNKNOWN: 'template.canvas_unknown',
  /** An avatar size that is not one of the three. */
  AVATAR_SIZE_UNKNOWN: 'template.avatar_size_unknown',
  /** No light background image. The dark one is optional; this one is not. */
  IMAGE_MISSING: 'template.image_missing',

  ROOM_OVERLAP: 'template.room_overlap',
  ROOM_OUTSIDE_CANVAS: 'template.room_outside_canvas',
  ROOM_TOO_SMALL: 'template.room_too_small',
  ROOM_NAME_DUPLICATE: 'template.room_name_duplicate',
  ROOM_NAME_EMPTY: 'template.room_name_empty',
  ROOM_TYPE_UNKNOWN: 'template.room_type_unknown',
  ROOM_BAR_UNKNOWN: 'template.room_bar_unknown',
  ROOMS_TOO_MANY: 'template.rooms_too_many',
  /** No reception, or no break room. A template cannot be short of either. */
  ROOM_REQUIRED_MISSING: 'template.room_required_missing',
  /** A second reception, or a second break room. */
  ROOM_REQUIRED_DUPLICATE: 'template.room_required_duplicate',

  AREA_OUTSIDE_ROOM: 'template.area_outside_room',
  AREA_OVERLAP: 'template.area_overlap',
  AREA_OVERLAPS_BAR: 'template.area_overlaps_bar',
  /** Cell counts that are not whole numbers, or are zero or negative. */
  AREA_FRACTIONAL: 'template.area_fractional',
} as const

export type TemplateErrorCode = (typeof TemplateError)[keyof typeof TemplateError]

/** Build an issue. Present so every producer gets the same shape. */
export function issue(
  code: TemplateErrorCode,
  path: string,
  message: string,
  fields?: Record<string, string>,
): TemplateIssue {
  return fields ? { code, path, message, fields } : { code, path, message }
}

/**
 * What a validator returns.
 *
 * A discriminated union rather than throwing, because the builder validates on
 * every drag and wants every problem at once, not the first one.
 */
export type Validated<T> = { ok: true; value: T } | { ok: false; issues: TemplateIssue[] }
