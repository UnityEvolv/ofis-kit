import { Popover } from '@unityevolv/unitykit'

import { PersonAvatar } from './PersonAvatar.js'
import type { Token } from './placement.js'
import type { LiveReaction } from './useCall.js'

/**
 * The people a room has no cell for.
 *
 * User areas are display slots, not seats, so a room can hold more people than it
 * has cells — and when it does, the last cell counts the rest. The counter is drawn
 * **as an avatar** rather than as a badge: it takes a person's place in the room,
 * it sits in a person's cell, and the thing it stands for is people. A small pill
 * in a row of faces reads as a notification rather than as four more colleagues.
 *
 * Opening it shows those people the same way the room shows everybody else: as
 * avatars, with their status and whatever they are doing in the call, three
 * across and three down, scrolling for the rest. A list of names would be the one
 * place in the office where people stopped looking like people.
 */

/** Three across and three down, then it scrolls. */
export const OVERFLOW_COLUMNS = 3
export const OVERFLOW_ROWS = 3

/** Each avatar in the grid, in pixels. Fixed, because the room's cells can be tiny. */
const CELL = 60
/**
 * One row: the face, the name under it, and room above it for a raised hand, which
 * sits outside the circle on purpose and would otherwise be clipped by the row
 * above.
 */
const ROW = 72
const GAP = 4

/**
 * How tall the list may be.
 *
 * Three rows, and the rest scroll: a room of forty people is a panel of nine faces
 * and a scrollbar, not a panel taller than the map. Fewer when the screen has less
 * room than that on either side of the counter — Radix measures what is available,
 * and a short phone may have less than three rows' worth above or below. The
 * subtraction is the panel's own padding.
 */
export const OVERFLOW_MAX_HEIGHT = `min(${OVERFLOW_ROWS * ROW + (OVERFLOW_ROWS - 1) * GAP}px, calc(var(--radix-popover-content-available-height, 100vh) - 3.5rem))`

/**
 * Give the popover's dialog the list's name.
 *
 * The kit's Popover renders Radix's content as `role="dialog"` and has no prop to
 * name it, so without this every screen reader announces an unnamed dialog before
 * it reaches the list. Set from inside, once the list is mounted, because the
 * dialog is the list's own ancestor and nothing outside the popover can reach it.
 * Worth moving into the kit, where every popover would get it.
 */
const nameTheDialog = (name: string) => (node: HTMLElement | null) => {
  node?.closest('[role="dialog"]')?.setAttribute('aria-label', name)
}

export interface OverflowAvatarProps {
  roomName: string
  /** Everyone the counter stands for, in arrival order. */
  tokens: readonly Token[]
  /** The room's cell width, so the counter is the size of the faces beside it. */
  size: number
  reducedMotion?: boolean
  /** Reactions by person. The same map the room's avatars read. */
  reactions?: ReadonlyMap<string, LiveReaction[]>
}

export function OverflowAvatar({
  roomName,
  tokens,
  size,
  reducedMotion = false,
  reactions,
}: OverflowAvatarProps) {
  const count = tokens.length
  // The same proportions as a person's avatar, so the counter lines up with the
  // row it is in rather than looking like something laid on top of it.
  const face = Math.round(size * 0.62)
  const label = `+${count}`

  return (
    <Popover
      width="auto"
      trigger={
        <button
          type="button"
          aria-label={`${count} more in ${roomName}. Activate to see them.`}
          data-testid="overflow-avatar"
          className="flex cursor-pointer select-none flex-col items-center gap-1 rounded-lg focus-visible:outline-2 focus-visible:outline-primary"
          style={{ width: size }}
        >
          <span
            aria-hidden="true"
            className="grid place-items-center rounded-full bg-neutral font-semibold text-neutral-content ring-1 ring-base-300"
            // Three characters from +10 upwards, so the digits shrink rather than
            // spill out of the circle.
            style={{
              width: face,
              height: face,
              fontSize: Math.max(10, face * (label.length > 2 ? 0.32 : 0.38)),
            }}
          >
            {label}
          </span>
          <span
            aria-hidden="true"
            className="max-w-full truncate rounded bg-base-100/85 px-1 text-center leading-tight text-base-content backdrop-blur-[2px]"
            style={{ fontSize: Math.max(9, size * 0.17) }}
          >
            more
          </span>
        </button>
      }
    >
      <ul
        aria-label={`${count} more in ${roomName}`}
        data-testid="overflow-grid"
        /*
          Focusable, so the keyboard can scroll it.

          Nothing inside is focusable — an avatar here is a picture of a person, not
          a control — so without this the people after the ninth could be seen with
          a mouse wheel and reached by nobody else. Being the first thing that takes
          focus also means the popover opens onto a named list rather than onto its
          own frame.
        */
        tabIndex={0}
        ref={nameTheDialog(`${count} more in ${roomName}`)}
        className="grid overflow-y-auto overscroll-contain rounded focus-visible:outline-2 focus-visible:outline-primary"
        style={{
          gridTemplateColumns: `repeat(${OVERFLOW_COLUMNS}, ${CELL}px)`,
          gridAutoRows: `${ROW}px`,
          gap: GAP,
          maxHeight: OVERFLOW_MAX_HEIGHT,
        }}
      >
        {tokens.map((token) => (
          <li key={token.key} className="flex justify-center pt-2.5">
            <PersonAvatar
              person={token.person}
              size={CELL}
              {...(token.deviceId ? { deviceId: token.deviceId } : {})}
              linked={token.linked}
              reducedMotion={reducedMotion}
              reactions={reactions?.get(token.person.userId) ?? []}
            />
          </li>
        ))}
      </ul>
    </Popover>
  )
}
