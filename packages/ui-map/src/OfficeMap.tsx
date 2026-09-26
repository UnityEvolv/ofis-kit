import { Icon } from '@unityevolv/unitykit'
import type { OfficeState, PublicPresence, RoomCall } from '@unityevolv/ofiskit-realtime-client'
import { callIn, isLocked, occupancy, peopleIn, yourRoom } from '@unityevolv/ofiskit-realtime-client'
import { barRect, type Room, type Template } from '@unityevolv/ofiskit-template'
import { useCallback, useEffect, useState } from 'react'

import { OverflowAvatar } from './Overflow.js'
import { PersonAvatar } from './PersonAvatar.js'
import { RoomBar } from './RoomBar.js'
import { fitCanvas, readingOrder, roomInDirection, toPixels, type CanvasBox } from './layout.js'
import { placeInRoom } from './placement.js'
import { useMeasured, usePersisted, useReducedMotion } from './hooks.js'
import type { LiveReaction } from './useCall.js'
import { useTheme } from './theme.js'

/**
 * The office: the background image with rooms drawn over it, and people in them.
 *
 * The picture is the point of the product, and it is also the hardest thing here
 * to use without sight or a mouse. So the map is a landmark region, every room is
 * a labelled group in reading order, arrow keys move between rooms, Enter joins or
 * knocks, and there is a list view carrying exactly the same state and the same
 * actions for anybody who would rather not have a picture at all.
 *
 * Nothing is drawn directly onto the image. Every bar, avatar and dot is a kit
 * surface with its own contrast, because the image is whatever an author
 * generated and nothing legible can be guaranteed on top of it.
 */

export interface OfficeMapProps {
  template: Template
  state: OfficeState
  /** Turns a template's image name into something the browser can fetch. */
  imageUrl(name: string): string
  /** Capacity is an office setting; the free office has none. */
  capacityOf?(room: Room): number | null
  /**
   * A line for a room's bar from the host, such as a meeting booked there
   * soon. The free office has none.
   */
  noticeOf?(room: Room): string | null
  /**
   * Reactions in the air, by person. From `useReactions`.
   *
   * By person rather than by device here, because an avatar is a person — the same
   * reaction is keyed by device for the tiles, which are screens.
   */
  reactions?: ReadonlyMap<string, LiveReaction[]>
  onJoin(roomId: string): void
  onKnock(roomId: string): void
  onLock(roomId: string): void
  onUnlock(roomId: string): void
}

export function OfficeMap(props: OfficeMapProps) {
  const { template, state, imageUrl, capacityOf, reactions } = props
  const { theme } = useTheme()
  const reducedMotion = useReducedMotion()

  // Measured rather than guessed: the map shares its space with the tile strip,
  // which appears and disappears as calls start and end.
  const [container, box] = useMeasured<HTMLElement>()
  const [focused, setFocused] = useState<string | null>(null)

  const canvas: CanvasBox = fitCanvas(template.canvas, box)
  const ordered = readingOrder(template.rooms)
  const yourRoomId = yourRoom(state)

  /**
   * The template's dark image in dark mode, the light one otherwise.
   *
   * Swapped in place without reloading the office, so changing theme mid-call is a
   * repaint rather than an interruption. Theme is per person, so two people in the
   * same room may be looking at different pictures over identical geometry.
   */
  const background =
    theme === 'dark' && template.images.dark ? template.images.dark : template.images.light

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent, room: Room) => {
      /*
       * Only keys pressed on the room itself.
       *
       * The room is a focusable group with controls inside it — Join, Lock, Knock,
       * the overflow counter — and a key pressed on any of them bubbles up to here.
       * Handling it here as well turned Enter on Lock into nothing, Enter on the
       * counter into walking into the room, and the arrow keys inside the counter's
       * list into jumping to the next room. React carries events up through
       * portals too, so the counter's popover is inside this group as far as this
       * handler is concerned, even though it is drawn somewhere else in the page.
       */
      if (event.target !== event.currentTarget) return

      const directions: Record<string, 'left' | 'right' | 'up' | 'down'> = {
        ArrowLeft: 'left',
        ArrowRight: 'right',
        ArrowUp: 'up',
        ArrowDown: 'down',
      }
      const direction = directions[event.key]

      if (direction) {
        const next = roomInDirection(ordered, room, direction)
        if (next) {
          event.preventDefault()
          setFocused(next.id)
          container.current?.querySelector<HTMLElement>(`[data-room="${next.id}"]`)?.focus()
        }
        return
      }

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        if (room.id === yourRoomId) return
        if (isLocked(state, room.id)) props.onKnock(room.id)
        else props.onJoin(room.id)
      }
    },
    [container, ordered, state, yourRoomId, props],
  )

  return (
    <section
      ref={container}
      aria-label={`${template.name} office map`}
      className="relative h-full w-full overflow-hidden bg-base-200"
    >
      {/*
        A skeleton until the first snapshot lands.

        Drawing the rooms with nobody in them would be a lie for a moment, and it
        is the worst possible moment for one: somebody reloading sees an empty
        office and believes it before the people appear. An office that is
        visibly still arriving is honest and reads as faster.
      */}
      {!state.ready && (
        <p
          className="absolute inset-x-0 top-1/2 text-center text-sm text-base-content/60"
          role="status"
        >
          Looking around the office…
        </p>
      )}

      {canvas.width > 0 && state.ready && (
        <>
          <img
            src={imageUrl(background)}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="absolute select-none"
            style={{
              left: canvas.left,
              top: canvas.top,
              width: canvas.width,
              height: canvas.height,
            }}
          />

          {ordered.map((room) => {
            const pixels = toPixels(room.rect, canvas)
            const people = peopleIn(state, room.id)
            const locked = isLocked(state, room.id)
            const capacity = capacityOf?.(room) ?? null
            const inside = room.id === yourRoomId
            const count = occupancy(state, room.id)
            const call = callIn(state, room.id)
            const placement = placeInRoom(room, people, template.canvas, template.avatarSize)
            const bar = toPixels(barRect(room.rect, room.bar, template.canvas), canvas)

            return (
              <div
                key={room.id}
                data-room={room.id}
                role="group"
                tabIndex={0}
                /*
                 * Name, type, occupancy, lock state, and what Enter will do — in
                 * that order, because that is the order somebody decides in: what
                 * is this, who is in it, can I get in.
                 */
                aria-label={[
                  room.name,
                  room.type === 'break' ? 'break room' : room.type,
                  `${count} ${count === 1 ? 'person' : 'people'}`,
                  capacity === null ? '' : `of ${capacity}`,
                  // Announced while arrowing between rooms, which is how somebody
                  // who cannot see the map decides where to go. Without it the call
                  // is drawn on the bar and said nowhere.
                  call
                    ? `call with ${call.participants.length} ${
                        call.participants.length === 1 ? 'person' : 'people'
                      }${call.participants.length >= call.limit ? ', full' : ''}`
                    : '',
                  locked ? 'locked' : 'open',
                  inside ? 'you are here' : locked ? 'press Enter to knock' : 'press Enter to join',
                ]
                  .filter(Boolean)
                  .join(', ')}
                onKeyDown={(event) => onKeyDown(event, room)}
                onFocus={() => setFocused(room.id)}
                className={[
                  'absolute rounded-md outline-offset-2',
                  'focus-visible:outline-2 focus-visible:outline-primary',
                  inside ? 'ring-2 ring-primary' : 'ring-1 ring-base-content/10',
                  focused === room.id ? 'z-20' : 'z-10',
                ].join(' ')}
                style={{
                  left: pixels.left,
                  top: pixels.top,
                  width: pixels.width,
                  height: pixels.height,
                }}
              >
                <div
                  className="pointer-events-none absolute z-10"
                  style={{ left: 0, top: bar.top - pixels.top, width: pixels.width }}
                >
                  <RoomBar
                    room={room}
                    occupancy={count}
                    capacity={capacity}
                    locked={locked}
                    inside={inside}
                    call={call}
                    notice={props.noticeOf?.(room) ?? null}
                    width={pixels.width}
                    onJoin={() => props.onJoin(room.id)}
                    onKnock={() => props.onKnock(room.id)}
                    onLock={() => props.onLock(room.id)}
                    onUnlock={() => props.onUnlock(room.id)}
                  />
                </div>

                <ul className="contents" aria-label={`People in ${room.name}`}>
                  {placement.placed.map(({ token, rect }) => {
                    const cell = toPixels(rect, canvas)
                    return (
                      <li
                        key={token.key}
                        className="absolute flex items-start justify-center"
                        style={{
                          left: cell.left - pixels.left,
                          top: cell.top - pixels.top,
                          width: cell.width,
                          height: cell.height,
                          // A move is a position change, so the browser animates
                          // it and the eye can follow who went where. Reduced
                          // motion means they simply appear in the new room.
                          transition: reducedMotion ? undefined : 'left 220ms ease, top 220ms ease',
                        }}
                      >
                        <PersonAvatar
                          person={token.person}
                          size={cell.width}
                          {...(token.deviceId ? { deviceId: token.deviceId } : {})}
                          linked={token.linked}
                          reducedMotion={reducedMotion}
                          reactions={reactions?.get(token.person.userId) ?? []}
                        />
                      </li>
                    )
                  })}

                  {/*
                    More people than cells: the last cell counts the rest rather
                    than the room overflowing or everybody shrinking. Drawn as an
                    avatar in a person's cell, because what it stands for is people,
                    and it opens onto them drawn the same way.
                  */}
                  {placement.overflowAt &&
                    (() => {
                      const cell = toPixels(placement.overflowAt, canvas)
                      return (
                        <li
                          className="absolute flex items-start justify-center"
                          style={{
                            left: cell.left - pixels.left,
                            top: cell.top - pixels.top,
                            width: cell.width,
                            height: cell.height,
                          }}
                        >
                          <OverflowAvatar
                            roomName={room.name}
                            tokens={placement.overflow}
                            size={cell.width}
                            reducedMotion={reducedMotion}
                            {...(reactions ? { reactions } : {})}
                          />
                        </li>
                      )
                    })()}
                </ul>
              </div>
            )
          })}
        </>
      )}
    </section>
  )
}

/**
 * The same office as a list.
 *
 * The accessible alternative to the map, and genuinely useful on a small laptop
 * where the picture is too small to click. It shows the same state, offers the
 * same actions and updates from the same realtime state, so the two can never
 * disagree — which is the only reason it is safe to offer at all.
 */
export function RoomListView(props: OfficeMapProps) {
  const { template, state, capacityOf, reactions } = props
  const yourRoomId = yourRoom(state)
  const reducedMotion = useReducedMotion()

  if (!state.ready) {
    return (
      <nav aria-label={`${template.name} rooms`} className="h-full overflow-auto p-2">
        <p className="p-2 text-sm text-base-content/60" role="status">
          Looking around the office…
        </p>
      </nav>
    )
  }

  /*
   * The two rooms every office has come first, side by side, and then everything
   * else in the order the map reads.
   *
   * Reception is where everybody arrives and the break room is where they go to
   * step away, so they are the two rooms somebody looks for without knowing the
   * office — and they are the same two in every office, which makes the top of the
   * list the one part of it that never moves. Placed first rather than wherever the
   * author drew them, so a phone shows them without scrolling.
   */
  const ordered = readingOrder(template.rooms)
  const shared = (['reception', 'break'] as const).flatMap((type) =>
    ordered.filter((room) => room.type === type),
  )
  const rest = ordered.filter((room) => room.type !== 'reception' && room.type !== 'break')

  const card = (room: Room, half: boolean) => (
    <RoomCard
      key={room.id}
      room={room}
      half={half}
      people={peopleIn(state, room.id)}
      locked={isLocked(state, room.id)}
      inside={room.id === yourRoomId}
      call={callIn(state, room.id)}
      capacity={capacityOf?.(room) ?? null}
      notice={props.noticeOf?.(room) ?? null}
      reducedMotion={reducedMotion}
      {...(reactions ? { reactions } : {})}
      onJoin={() => props.onJoin(room.id)}
      onKnock={() => props.onKnock(room.id)}
      onLock={() => props.onLock(room.id)}
      onUnlock={() => props.onUnlock(room.id)}
    />
  )

  return (
    <nav aria-label={`${template.name} rooms`} className="h-full overflow-auto p-2">
      {/* One list, so a screen reader hears one set of rooms in one order; the grid
          is only how it is drawn. */}
      <ul className="grid grid-cols-2 gap-2">
        {shared.map((room) => card(room, true))}
        {rest.map((room) => card(room, false))}
      </ul>
    </nav>
  )
}

/**
 * One room in the list: its bar, and the people in it.
 *
 * A half-width card measures itself, because on a narrow phone half the screen is
 * too little for a room bar's full form: without the compact one, the name is what
 * gets crushed. A full-width card never needs to — it is the width somebody chose
 * this view for, and there is no room rectangle constraining it.
 */
function RoomCard(props: {
  room: Room
  half: boolean
  people: PublicPresence[]
  locked: boolean
  inside: boolean
  call: RoomCall | null
  capacity: number | null
  notice: string | null
  reducedMotion: boolean
  reactions?: ReadonlyMap<string, LiveReaction[]>
  onJoin(): void
  onKnock(): void
  onLock(): void
  onUnlock(): void
}) {
  const { room, half, people } = props
  const [measured, size] = useMeasured<HTMLLIElement>()
  // Until the first measurement arrives, assume there is room: a bar that starts in
  // its full form and tightens is better than one that starts cramped.
  const width = half && size.width > 0 ? size.width : Number.MAX_SAFE_INTEGER

  return (
    <li
      ref={measured}
      className={[
        'min-w-0 rounded-lg bg-base-100 p-2 ring-1 ring-base-300',
        half ? '' : 'col-span-2',
      ].join(' ')}
    >
      <RoomBar
        room={room}
        occupancy={people.length}
        capacity={props.capacity}
        locked={props.locked}
        inside={props.inside}
        call={props.call}
        notice={props.notice}
        width={width}
        onJoin={props.onJoin}
        onKnock={props.onKnock}
        onLock={props.onLock}
        onUnlock={props.onUnlock}
      />

      {people.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-3 px-1" aria-label={`People in ${room.name}`}>
          {people.map((person) => (
            <li key={person.userId}>
              <PersonAvatar
                person={person}
                size={56}
                reducedMotion={props.reducedMotion}
                reactions={props.reactions?.get(person.userId) ?? []}
              />
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

/** Which of the two views somebody is looking at. Remembered, because it is a preference. */
export type OfficeView = 'map' | 'list'

export function ViewToggle({
  view,
  onChange,
}: {
  view: OfficeView
  onChange(view: OfficeView): void
}) {
  return (
    <div className="inline-flex rounded-md ring-1 ring-base-300" role="group" aria-label="Office view">
      {(['map', 'list'] as const).map((candidate) => (
        <button
          key={candidate}
          type="button"
          onClick={() => onChange(candidate)}
          aria-pressed={view === candidate}
          className={[
            'inline-flex min-h-8 items-center gap-1 px-2 py-1 text-xs first:rounded-l-md last:rounded-r-md',
            'focus-visible:outline-2 focus-visible:outline-primary',
            view === candidate ? 'bg-primary text-primary-content' : 'hover:bg-base-200',
          ].join(' ')}
        >
          <Icon name={candidate === 'map' ? 'office' : 'menu'} size="xs" />
          {/* Icons alone on a phone, where the bar has no width to spare. Still the
              button's name for a screen reader, so nothing is lost but the pixels. */}
          <span className="max-sm:sr-only">{candidate === 'map' ? 'Map' : 'List'}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * Hide everything but the office.
 *
 * Exported from here although this app has no chrome to hide: the control belongs
 * to the shared package because the wrapper's app shell is what it hides, and a
 * second copy of it there would be a second set of behaviour to keep right.
 *
 * Somebody who works maximised should not have to set it every session, so the
 * choice is remembered. Escape gets out, because a mode with no visible way back
 * is a trap.
 */
export function useMaximised(): [boolean, (next: boolean) => void] {
  const [maximised, setMaximised] = usePersisted('ofiskit:maximised', false)

  useEffect(() => {
    if (!maximised) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMaximised(false)
    }
    globalThis.addEventListener('keydown', onKey)
    return () => globalThis.removeEventListener('keydown', onKey)
  }, [maximised, setMaximised])

  return [maximised, setMaximised]
}

/** The control that toggles it, so the label and the icon stay in one place. */
export function MaximiseButton({
  maximised,
  onToggle,
}: {
  maximised: boolean
  onToggle(): void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
      aria-pressed={maximised}
    >
      <Icon name={maximised ? 'minimize' : 'maximize'} size="sm" />
      {maximised ? 'Restore' : 'Maximise'}
    </button>
  )
}
