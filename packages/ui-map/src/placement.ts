import type { PublicPresence } from '@unityevolv/ofiskit-realtime-client'
import {
  avatarUnit,
  type AvatarSize,
  type CanvasShape,
  type Rect,
  type Room,
} from '@unityevolv/ofiskit-template'

/**
 * Putting people into a room's cells.
 *
 * User areas are **display slots, not seats**. Capacity is a separate,
 * office-level number, so a room can perfectly well hold more people than it has
 * cells — and when it does, the last cell becomes a counter rather than the
 * layout breaking or avatars piling on top of each other.
 */

/** One avatar to draw: usually a person, sometimes one of their devices. */
export interface Token {
  key: string
  person: PublicPresence
  /** Set when this avatar is one device of a person drawn once per device. */
  deviceId?: string
  /** Linked to another avatar for the same person, so the pair reads as one. */
  linked: boolean
}

/**
 * Which of somebody's devices get an avatar of their own.
 *
 * One avatar per person is the answer almost always, because **presence is per
 * user**: somebody with a laptop and a phone open is one person standing in one
 * room, and drawing them twice would say the opposite of what the rest of the
 * product says. The device badge is how you tell they are on a phone.
 *
 * The exception is a call. Two devices in one call are two real legs in the mesh,
 * each with its own camera and microphone, and each takes a place in it — so they
 * are drawn as two linked avatars. That predicate needs call state, which is why
 * this is a parameter rather than a rule written in here, and why the caller that
 * passes one arrives with the call stories.
 */
export type DevicesToDraw = (person: PublicPresence) => PublicPresence['devices']

/** One avatar per person. What the map uses until calls exist. */
const asOnePerson: DevicesToDraw = () => []

/**
 * Expand the people in a room into the avatars to draw.
 *
 * Arrival order, so somebody who has been in the corner of a room for an hour is
 * still in that corner after four other people have come and gone.
 */
export function tokensFor(
  people: readonly PublicPresence[],
  devicesToDraw: DevicesToDraw = asOnePerson,
): Token[] {
  const tokens: Token[] = []

  for (const person of people) {
    const separately = devicesToDraw(person)

    // One device drawn separately is still just the person, so it gets the plain
    // avatar rather than a link to nothing.
    if (separately.length > 1) {
      for (const device of separately) {
        tokens.push({
          key: `${person.userId}:${device.deviceId}`,
          person,
          deviceId: device.deviceId,
          linked: true,
        })
      }
    } else {
      tokens.push({ key: person.userId, person, linked: false })
    }
  }

  return tokens
}

export interface PlacedAvatar {
  token: Token
  /** Normalized against the canvas, like everything else in a template. */
  rect: Rect
}

export interface Placement {
  placed: PlacedAvatar[]
  /** The cell the counter goes in, when there are more people than cells. */
  overflowAt: Rect | null
  /** Everyone the counter stands for. */
  overflow: Token[]
  /** The size of one cell, normalized, for sizing the avatars. */
  cell: { width: number; height: number }
}

/**
 * Lay a room's avatars out over its user areas.
 *
 * Cells are filled in the order the author placed the areas, and within an area
 * left to right then top to bottom, which is how somebody reads the picture.
 *
 * When there are more people than cells, the **last** cell becomes a counter.
 * Four cells and twelve people shows three faces and a `+9`, rather than
 * shrinking everyone to nothing or spilling outside the room.
 */
export function placeInRoom(
  room: Room,
  people: readonly PublicPresence[],
  shape: CanvasShape,
  avatarSize: AvatarSize,
  devicesToDraw?: DevicesToDraw,
): Placement {
  const unit = avatarUnit(shape, avatarSize)
  const tokens = tokensFor(people, devicesToDraw)

  const cells: Rect[] = []
  for (const area of room.areas) {
    for (let row = 0; row < area.rows; row += 1) {
      for (let column = 0; column < area.columns; column += 1) {
        cells.push({
          x: area.x + column * unit.width,
          y: area.y + row * unit.height,
          width: unit.width,
          height: unit.height,
        })
      }
    }
  }

  if (cells.length === 0 || tokens.length === 0) {
    return { placed: [], overflowAt: null, overflow: [], cell: unit }
  }

  if (tokens.length <= cells.length) {
    return {
      placed: tokens.flatMap((token, index) => {
        const rect = cells[index]
        return rect ? [{ token, rect }] : []
      }),
      overflowAt: null,
      overflow: [],
      cell: unit,
    }
  }

  const shown = cells.length - 1
  return {
    placed: tokens.slice(0, shown).flatMap((token, index) => {
      const rect = cells[index]
      return rect ? [{ token, rect }] : []
    }),
    overflowAt: cells[shown] ?? null,
    overflow: tokens.slice(shown),
    cell: unit,
  }
}
