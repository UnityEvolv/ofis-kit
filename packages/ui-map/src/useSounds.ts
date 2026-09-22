import type { OfficeState, OfisClient } from '@unityevolv/ofiskit-realtime-client'
import { peopleIn, you as yourPresence, yourRoom } from '@unityevolv/ofiskit-realtime-client'
import { useCallback, useEffect, useRef } from 'react'

import { useClientEvents } from './hooks.js'
import { createSounds, type Sounds } from './sounds.js'

/**
 * When the office makes a sound.
 *
 * Three moments, each one about somebody reaching you:
 * - somebody knocks on the door of the room you are in — a knock;
 * - somebody walks into the room you are in — a chime;
 * - the room you knocked on lets you in — a chime.
 *
 * And the times it stays quiet, which matter as much:
 * - arrivals in reception, which is where everybody arrives — a chime every time
 *   somebody walked into the office would be noise, not news;
 * - a knock the server marked silent, because everybody inside is on do not
 *   disturb;
 * - anything at all while you are on do not disturb yourself;
 * - your own moves, which you do not need telling about;
 * - everything, when the person has turned sounds off.
 */

export interface UseSoundsOptions {
  /** The person's own switch. On by default in the app, and remembered per device. */
  enabled: boolean
  /** Rooms where arrivals make no sound: reception, where everybody lands. */
  quietRoomIds: readonly string[]
  /** The speaker chosen for calls, so the office's sounds come out of the same place. */
  speakerDeviceId?: string
  /** Injected in tests; the browser's own sounds otherwise. */
  sounds?: Sounds
}

export function useSounds(client: OfisClient, state: OfficeState, options: UseSoundsOptions): void {
  const sounds = useRef<Sounds | null>(options.sounds ?? null)
  const play = useCallback((which: 'knock' | 'chime') => {
    sounds.current ??= createSounds()
    sounds.current[which]()
  }, [])

  const { enabled, quietRoomIds, speakerDeviceId } = options
  const doNotDisturb = yourPresence(state)?.status === 'dnd'
  const quiet = !enabled || doNotDisturb

  useEffect(() => {
    sounds.current?.useSpeaker(speakerDeviceId)
  }, [speakerDeviceId])

  useClientEvents(
    client,
    useCallback(
      (event) => {
        if (quiet) return
        if (event.type === 'knock' && !event.silent) play('knock')
        if (event.type === 'admitted') play('chime')
      },
      [play, quiet],
    ),
  )

  /*
   * Arrivals, noticed as a change in who is in your room.
   *
   * Compared against the last time the room was looked at, and only when you are
   * still in the same room: when you move, everybody in the new room is "new", and
   * none of them arrived.
   */
  const roomId = yourRoom(state)
  const others = roomId
    ? peopleIn(state, roomId)
        .map((person) => person.userId)
        .filter((userId) => userId !== state.you.userId)
        .sort()
    : []
  const key = others.join(',')

  const last = useRef<{ roomId: string | null; people: Set<string> }>({
    roomId: null,
    people: new Set(),
  })

  useEffect(() => {
    const before = last.current
    const now = { roomId, people: new Set(key ? key.split(',') : []) }
    last.current = now

    if (quiet || !roomId || before.roomId !== roomId) return
    if (quietRoomIds.includes(roomId)) return
    if ([...now.people].some((userId) => !before.people.has(userId))) play('chime')
  }, [key, play, quiet, quietRoomIds, roomId])
}
