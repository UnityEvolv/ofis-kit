import { Button, Icon } from '@unityevolv/unitykit'
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
  /**
   * A line the host adds under the bar, such as a meeting booked in the room
   * soon. Shown only when nothing more urgent is: a reason you cannot go in
   * outranks a note about later.
   */
  notice?: string | null
  /** How wide the room is on screen, which decides how much the bar can show. */
  width: number
  onJoin(): void
  onKnock(): void
  onLock(): void
  onUnlock(): void
}

/** Below this, the bar shows icons only and the name is truncated. */
const COMPACT_BELOW = 190
/**
 * Below this there is room for the name and the action and nothing else.
 *
 * A room this narrow is a room on a phone's map, where a bar is about 65 to 90
 * pixels wide. The name at its two-character minimum, the gaps and a worded Join
 * come to about 62, so a call badge beside them — even as a bare icon — would push
 * Join off the bar's clipped edge.
 */
const TINY_BELOW = 110

interface Action {
  key: string
  label: string
  /**
   * Set for the buttons that are an icon and nothing else: Lock and Unlock.
   *
   * A padlock says lock and unlock better than the words do, and the words are
   * still the button's accessible name. Join and Knock stay words at every width:
   * they are what somebody outside the room came to the bar to do, and a word is
   * what they look for.
   */
  icon?: 'lock' | 'unlock'
  onClick(): void
  disabled: boolean
  /** Why it is disabled, shown in the message row. */
  reason?: string
  /**
   * Join is the one primary action. Knocking, locking and unlocking are secondary:
   * they are about the door rather than about going through it, and a bar of
   * equally loud buttons is a bar with no answer to "what do I press".
   */
  variant: 'primary' | 'secondary'
}

export function RoomBar(props: RoomBarProps) {
  const { room, occupancy, capacity, locked, inside, forbiddenReason, width } = props
  const compact = width < COMPACT_BELOW
  const tiny = width < TINY_BELOW

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
        onClick: props.onKnock,
        disabled: Boolean(forbiddenReason),
        ...(forbiddenReason ? { reason: forbiddenReason } : {}),
        variant: 'secondary',
      })
    } else {
      // The adapter's reason wins over the room being full: "you are a guest" is
      // more useful than "it is full", because one of them will still be true in
      // ten minutes.
      const reason = forbiddenReason ?? (full ? `${room.name} is full.` : undefined)
      actions.push({
        key: 'join',
        label: 'Join',
        onClick: props.onJoin,
        disabled: Boolean(reason),
        ...(reason ? { reason } : {}),
        variant: 'primary',
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
            variant: 'secondary',
          }
        : {
            key: 'lock',
            label: 'Lock',
            icon: 'lock',
            onClick: props.onLock,
            disabled: false,
            variant: 'secondary',
          },
    )
  }

  // One message at a time. Two stacked reasons is a paragraph on a room bar, and
  // the first one is the one stopping you. A full call comes second, because it
  // stops you doing less: you can still go in and listen.
  const message =
    actions.find((action) => action.disabled)?.reason ??
    (callFull ? `The call in ${room.name} is full. You can still go in.` : null) ??
    props.notice ??
    null

  const typeIcon =
    room.type === 'reception' ? 'reception' : room.type === 'break' ? 'break-room' : 'office'

  return (
    <div
      // Translucent enough for the room's picture to show through, which is what
      // ties the bar to the room it sits on. The blur is what keeps it readable over
      // any picture: the surface still carries the contrast, never the image.
      className="pointer-events-auto flex w-full flex-col overflow-hidden rounded-md bg-base-100/50 text-base-content shadow backdrop-blur-sm"
      data-testid={`room-bar-${room.id}`}
    >
      <div className="flex min-w-0 items-center gap-1.5 px-1.5 py-1">
        {/*
          Reception and the break room are marked as what they are: one is where
          you arrive, the other is where you go when you are stepping away, and
          neither is obvious from a name somebody chose.
        */}
        {/*
          Not on a narrow bar, and neither is the head count below: in a room a few
          centimetres wide on a phone's map they took the width the name and Join
          needed, and the name was squeezed to nothing while Join ran off the edge.
          The name still says which room it is, and the count is in the room's own
          accessible name.
        */}
        <span className={['shrink-0 text-base-content/70', compact ? 'hidden' : ''].join(' ')}>
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
        <span
          className={['flex-1 truncate text-xs font-medium', tiny ? 'min-w-0' : 'min-w-[2ch]'].join(
            ' ',
          )}
          title={room.name}
        >
          {room.name}
        </span>

        {/*
          A call in progress, visible from outside the room.

          Everything about it is in one accessible name rather than in the parts:
          an icon and "3/4" read out separately are two fragments nobody can
          assemble, and the whole question somebody is asking is "is there a
          conversation in there, and is there room in it".
        */}
        {/*
          On a narrow bar the count goes and the microphone stays; on the tiniest
          it goes altogether, because the one thing a bar must always show is its
          action. Nothing is lost for a screen reader either way: the room's own
          name already says there is a call in it and how many people.
        */}
        {call && !tiny && (
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
            {!compact && (
              <span aria-hidden="true">
                {call.participants.length}/{call.limit}
              </span>
            )}
          </span>
        )}

        {/* Not on a narrow bar, where the button beside it — Knock from outside,
            Unlock from inside — already says the room is locked. */}
        {locked && !compact && (
          <span className="shrink-0 text-base-content/70">
            <Icon name="lock" size="xs" title={`${room.name} is locked`} />
          </span>
        )}

        {!compact && (
          <span className="shrink-0 text-[10px] tabular-nums text-base-content/60">
            {capacity === null ? occupancy : `${occupancy}/${capacity}`}
          </span>
        )}

        {actions.map((action) => {
          const shared = {
            size: 'xs' as const,
            variant: action.variant,
            // Tighter on a narrow bar, where a worded button has nothing to shrink
            // to: the utility beats the kit's own padding, which lives in the
            // component layer below it.
            className: compact && !action.icon ? 'shrink-0 px-1' : 'shrink-0',
            onClick: action.onClick,
            disabled: action.disabled,
            ...(action.disabled && action.reason ? { 'aria-describedby': `${room.id}-why` } : {}),
          }

          /*
            Lock and Unlock are a padlock at every width, with the word as their
            accessible name. Join and Knock are words at every width, with less
            padding around them on a narrow bar. What gives way instead is
            everything else: the head count, the room-type icon and the lock icon on
            a narrow bar, the call badge's count and then the badge itself on the
            tiniest — and the name truncates to its first letters, or on the very
            tiniest to nothing, because the room's action is never the thing that
            goes.
          */
          return action.icon ? (
            <Button key={action.key} {...shared} icon={action.icon} aria-label={action.label} />
          ) : (
            <Button key={action.key} {...shared}>
              {action.label}
            </Button>
          )
        })}
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
