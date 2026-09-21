import { Icon } from '@unityevolv/unitykit'
import type { RoomCall } from '@unityevolv/ofiskit-realtime-client'
import type { Room } from '@unityevolv/ofiskit-template'
import { hostsCalls } from '@unityevolv/ofiskit-template'

/**
 * The bar on a room: its name, what is happening in it, and what you can do.
 *
 * Two rows. The action row carries the name, the occupancy, the lock state and
 * the controls. The message row underneath explains why a control is disabled,
 * and is collapsed entirely when there is nothing to say, so an ordinary open room
 * does not carry a blank line.
 *
 * Controls that cannot be used are **disabled and visible, never hidden**. A
 * person needs to know that joining is a thing that exists and why they cannot do
 * it right now; a control that vanishes teaches them nothing. The server refuses
 * the same action independently, so the disabled state is a convenience and never
 * the control.
 */

export interface RoomBarProps {
  room: Room
  occupancy: number
  /** Null when the office does not cap rooms, which the free office never does. */
  capacity: number | null
  locked: boolean
  inside: boolean
  /**
   * The call happening in this room, if there is one.
   *
   * Null in reception and the break room always, because neither hosts a call —
   * and null in an ordinary room where nobody has started one yet. A room with a
   * call in it is the single most useful thing on this bar: it is the difference
   * between walking in on a conversation and joining one.
   */
  call?: RoomCall | null
  /** The identity adapter's answer, when the host has one. Never invented here. */
  forbiddenReason?: string | null
  /** How wide the room is on screen, which decides how much the bar can show. */
  width: number
  onJoin(): void
  onKnock(): void
  onLock(): void
  onUnlock(): void
}

/** Below this, the bar shows icons only and the name is truncated. */
const COMPACT_BELOW = 190

interface Action {
  key: string
  label: string
  icon: 'users' | 'knock' | 'lock' | 'unlock'
  onClick(): void
  disabled: boolean
  /** Why it is disabled, shown in the message row. */
  reason?: string
  primary?: boolean
}

export function RoomBar(props: RoomBarProps) {
  const { room, occupancy, capacity, locked, inside, forbiddenReason, width } = props
  const compact = width < COMPACT_BELOW

  const full = capacity !== null && occupancy >= capacity
  const lockable = hostsCalls(room.type)

  /*
   * The call, and whether there is a seat left in it.
   *
   * Two different fullnesses live on this bar and they are not the same thing: the
   * room can have space for ten more people while the call in it has none, because
   * the cap on the call is the provider's and the cap on the room is the office's.
   * Saying "full" without saying which would send somebody away from a room they
   * could have walked into.
   */
  const call = hostsCalls(room.type) ? (props.call ?? null) : null
  const callFull = call !== null && call.participants.length >= call.limit

  const actions: Action[] = []

  if (!inside) {
    if (locked) {
      actions.push({
        key: 'knock',
        label: 'Knock',
        icon: 'knock',
        onClick: props.onKnock,
        disabled: Boolean(forbiddenReason),
        ...(forbiddenReason ? { reason: forbiddenReason } : {}),
        primary: true,
      })
    } else {
      // The adapter's reason wins over the room being full: "you are a guest" is
      // more useful than "it is full", because one of them will still be true in
      // ten minutes.
      const reason = forbiddenReason ?? (full ? `${room.name} is full.` : undefined)
      actions.push({
        key: 'join',
        label: 'Join',
        icon: 'users',
        onClick: props.onJoin,
        disabled: Boolean(reason),
        ...(reason ? { reason } : {}),
        primary: true,
      })
    }
  } else if (lockable) {
    actions.push(
      locked
        ? {
            key: 'unlock',
            label: 'Unlock',
            icon: 'unlock',
            onClick: props.onUnlock,
            disabled: false,
          }
        : { key: 'lock', label: 'Lock', icon: 'lock', onClick: props.onLock, disabled: false },
    )
  }

  // One message at a time. Two stacked reasons is a paragraph on a room bar, and
  // the first one is the one stopping you. A full call comes second, because it
  // stops you doing less: you can still go in and listen.
  const message =
    actions.find((action) => action.disabled)?.reason ??
    (callFull ? `The call in ${room.name} is full. You can still go in.` : null)

  const typeIcon =
    room.type === 'reception' ? 'reception' : room.type === 'break' ? 'break-room' : 'office'

  return (
    <div
      className="pointer-events-auto flex w-full flex-col overflow-hidden rounded-md bg-base-100/95 text-base-content shadow ring-1 ring-base-300 backdrop-blur-sm"
      data-testid={`room-bar-${room.id}`}
    >
      <div className="flex min-w-0 items-center gap-1.5 px-1.5 py-1">
        {/*
          Reception and the break room are marked as what they are: one is where
          you arrive, the other is where you go when you are stepping away, and
          neither is obvious from a name somebody chose.
        */}
        <span className="shrink-0 text-base-content/70">
          <Icon
            name={typeIcon}
            size="xs"
            title={
              room.type === 'break'
                ? 'Break room — where you go when you are stepping away'
                : room.type === 'reception'
                  ? 'Reception — where you arrive'
                  : undefined
            }
          />
        </span>

        {/*
          The name never wraps and never overflows its room: it truncates, and the
          full name is available on hover and to a screen reader.
        */}
        <span className="min-w-0 flex-1 truncate text-xs font-medium" title={room.name}>
          {room.name}
        </span>

        {/*
          A call in progress, visible from outside the room.

          Everything about it is in one accessible name rather than in the parts:
          an icon and "3/4" read out separately are two fragments nobody can
          assemble, and the whole question somebody is asking is "is there a
          conversation in there, and is there room in it".
        */}
        {call && (
          <span
            role="img"
            aria-label={`Call with ${call.participants.length} ${
              call.participants.length === 1 ? 'person' : 'people'
            }${callFull ? ', full' : ''}`}
            data-testid={`room-call-${room.id}`}
            className={[
              'inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-px text-[10px] font-medium tabular-nums',
              callFull ? 'bg-base-200 text-base-content/70' : 'bg-primary/15 text-primary',
            ].join(' ')}
          >
            <Icon name="mic" size="xs" />
            <span aria-hidden="true">
              {call.participants.length}/{call.limit}
            </span>
          </span>
        )}

        {locked && (
          <span className="shrink-0 text-base-content/70">
            <Icon name="lock" size="xs" title={`${room.name} is locked`} />
          </span>
        )}

        <span className="shrink-0 text-[10px] tabular-nums text-base-content/60">
          {capacity === null ? occupancy : `${occupancy}/${capacity}`}
        </span>

        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
            aria-describedby={action.disabled && action.reason ? `${room.id}-why` : undefined}
            className={[
              'inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium',
              'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
              action.disabled
                ? 'cursor-not-allowed opacity-45'
                : action.primary
                  ? 'bg-primary text-primary-content hover:bg-primary/90'
                  : 'bg-base-200 hover:bg-base-300',
            ].join(' ')}
          >
            {/*
              On a narrow room the label goes and the icon stays, so the bar never
              wraps to a second line or overflows the room it belongs to. The
              accessible name comes from the icon's title either way.
            */}
            <Icon name={action.icon} size="xs" title={compact ? action.label : undefined} />
            {!compact && action.label}
          </button>
        ))}
      </div>

      {/*
        Collapsed to nothing when there is nothing to say. An empty row here would
        put a blank line under every open room in the office.
      */}
      {message && (
        <p
          id={`${room.id}-why`}
          className="border-t border-base-300 bg-base-200/70 px-1.5 py-0.5 text-[10px] leading-snug text-base-content/75"
        >
          {message}
        </p>
      )}
    </div>
  )
}
