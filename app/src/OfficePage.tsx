import { Button, Icon, Select } from '@unityevolv/unitykit'
import type { OfisClient } from '@unityevolv/ofiskit-realtime-client'
import { yourRoom } from '@unityevolv/ofiskit-realtime-client'
import {
  OfficeMap,
  RoomListView,
  ViewToggle,
  useAnnounce,
  useClientEvents,
  useOffice,
  usePersisted,
  useTheme,
  type OfficeView,
} from '@unityevolv/ofiskit-ui-map'
import { tilePlacement } from '@unityevolv/ofiskit-ui-map'
import type { Template } from '@unityevolv/ofiskit-template'
import { useCallback } from 'react'

import { officeImageUrl } from './config.js'

/**
 * The office, full window.
 *
 * No header above it and no product identity anywhere: this app is the office and
 * nothing else. In unityofis the same map renders inside the app shell, which adds
 * the header and the switchers — and adds nothing to this package to do it.
 *
 * The strip beside the map is where the call tiles go, and which side depends on
 * the canvas shape: a landscape office has width to spare and height at a premium,
 * so the tiles go across the top; a square or portrait one is the other way round.
 * The space is reserved from the first paint, because a strip that appears when a
 * call starts would resize the map underneath somebody's cursor.
 */

export interface OfficePageProps {
  client: OfisClient
  template: Template
  onLeave(): void
}

export function OfficePage({ client, template, onLeave }: OfficePageProps) {
  const state = useOffice(client)
  const announce = useAnnounce()
  const { choice, setChoice } = useTheme()
  const [view, setView] = usePersisted<OfficeView>('ofiskit:view', 'map')

  const roomId = yourRoom(state)
  const room = template.rooms.find((one) => one.id === roomId)
  const reception = template.rooms.find((one) => one.type === 'reception')
  const tiles = tilePlacement(template.canvas)

  /**
   * A refusal is said out loud, not only drawn.
   *
   * The optimistic move has already snapped back by the time this runs, which is
   * visible to anybody watching the screen and invisible to everybody else.
   */
  useClientEvents(
    client,
    useCallback(
      (event) => {
        if (event.type === 'refused') announce(event.message, 'assertive')
        if (event.type === 'closed') announce(event.message, 'assertive')
      },
      [announce],
    ),
  )

  const join = useCallback(
    (id: string) => {
      const target = template.rooms.find((one) => one.id === id)
      void client.joinRoom(id).then((result) => {
        if (result.ok && target) announce(`You are in ${target.name}.`)
      })
    },
    [announce, client, template.rooms],
  )

  const knock = useCallback(
    (id: string) => {
      const target = template.rooms.find((one) => one.id === id)
      void client.knock(id).then((result) => {
        if (!result.ok) return announce(result.message, 'assertive')
        announce(
          result.silent
            ? `You knocked on ${target?.name ?? 'the room'}. Everybody inside is on do not disturb, so it arrived silently.`
            : `You knocked on ${target?.name ?? 'the room'}.`,
        )
      })
    },
    [announce, client, template.rooms],
  )

  const props = {
    template,
    state,
    imageUrl: officeImageUrl,
    onJoin: join,
    onKnock: knock,
    onLock: (id: string) => void client.lock(id),
    onUnlock: (id: string) => void client.unlock(id),
  }

  return (
    <div className="flex h-full flex-col">
      <div className={['flex min-h-0 flex-1', tiles === 'top' ? 'flex-col' : 'flex-row'].join(' ')}>
        {/*
          Where the call tiles will be. Empty until the call stories land, and
          reserved from the start so the map is not resized the first time a call
          begins.
        */}
        <div
          aria-hidden="true"
          className={tiles === 'top' ? 'h-0 shrink-0' : 'w-0 shrink-0'}
          data-testid="tile-strip"
          data-placement={tiles}
        />

        <main className="min-h-0 min-w-0 flex-1">
          {view === 'map' ? <OfficeMap {...props} /> : <RoomListView {...props} />}
        </main>
      </div>

      {/*
        The controls bar. The call half of it arrives with the call stories; what
        is here is everything that is about the office rather than about a call.
      */}
      <footer className="flex flex-wrap items-center gap-2 border-t border-base-300 bg-base-100 px-3 py-2">
        <span className="text-sm">
          {room ? (
            <>
              You are in <span className="font-medium">{room.name}</span>
            </>
          ) : (
            'Finding your desk…'
          )}
        </span>

        {room && reception && room.id !== reception.id && (
          <Button size="sm" variant="ghost" onClick={() => void client.leaveRoom()}>
            <Icon name="chevron-left" size="sm" /> Back to {reception.name}
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <ViewToggle view={view} onChange={setView} />

          {/*
            Theme is per person, so two people in the same room may be looking at
            different background images over identical geometry.
          */}
          <Select
            // Named for assistive technology without a visible label, because the
            // three options say what it is and a footer is not the place for a
            // heading over a control that is two words wide.
            aria-label="Theme"
            value={choice}
            onChange={(event) => setChoice(event.target.value as typeof choice)}
          >
            <option value="system">System theme</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </Select>

          <Button size="sm" variant="ghost" onClick={onLeave}>
            <Icon name="log-out" size="sm" /> Leave
          </Button>
        </div>
      </footer>
    </div>
  )
}
