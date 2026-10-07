import type { Room, Template } from './types.js'

/**
 * Room ambience: a quiet background loop, chosen per room.
 *
 * Atmosphere while people work, never audio in a call. The template only names
 * a loop by id; it does not carry the sound, its address or its volume. Which
 * ids exist, and where their files are served from, is the host's library: a
 * folder beside the app here, storage in unityofis. That is what lets a loop be
 * replaced without touching a template that names it.
 *
 * Three states for a room, which is why there are two fields:
 * - the template's `ambience` is the office default, absent meaning silence;
 * - a room's `ambience` absent inherits that default;
 * - a room's `ambience` of `"none"` is silent whatever the default says;
 * - a room's `ambience` naming a loop overrides the default.
 *
 * Nothing here plays anything. Whether a person hears it is theirs to decide,
 * and how loud, and the engine is told both rather than deciding.
 */

/** A room's way of saying "silent here", whatever the office default is. */
export const AMBIENCE_NONE = 'none'

/** The longest id a library may use. Ids are stored in every template that names one. */
export const AMBIENCE_ID_MAX_LENGTH = 40

/** Lower-case words joined by single hyphens: `cafe`, `soft-rain`. */
const AMBIENCE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * One loop a host can play, as the builder lists it and the player fetches it.
 *
 * `label` is what a person reads; `src` is wherever the host serves the file
 * from. Neither is stored in a template, only the id.
 */
export interface AmbienceTrack {
  id: string
  label: string
  src: string
}

/**
 * True for a string shaped like a library id.
 *
 * Shape only: whether a loop with this id exists is the host's library to say,
 * since a template outlives any one list of loops and a library grows.
 * `"none"` is reserved and is never an id.
 */
export function isAmbienceId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= AMBIENCE_ID_MAX_LENGTH &&
    value !== AMBIENCE_NONE &&
    AMBIENCE_ID_PATTERN.test(value)
  )
}

/**
 * The loop that plays in a room, or null for silence.
 *
 * A room's own choice wins, `"none"` included; a room with no choice takes the
 * template's default; a template with no default is silent. An office whose
 * admin set nothing is silent, which is the point of making silence the
 * absence of a field.
 */
export function roomAmbience(template: Pick<Template, 'ambience'>, room: Room): string | null {
  if (room.ambience === AMBIENCE_NONE) return null
  if (room.ambience !== undefined) return room.ambience
  return template.ambience ?? null
}

/** The track a room plays from a library, or null when it is silent or the id is not in it. */
export function roomTrack(
  template: Pick<Template, 'ambience'>,
  room: Room,
  library: readonly AmbienceTrack[],
): AmbienceTrack | null {
  const id = roomAmbience(template, room)
  return id === null ? null : (library.find((track) => track.id === id) ?? null)
}
