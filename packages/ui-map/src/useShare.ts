import type { OfficeState, OfisClient, Sharer } from '@unityevolv/ofiskit-realtime-client'
import { sharerIn, yourRoom } from '@unityevolv/ofiskit-realtime-client'
import { useCallback, useEffect, useRef } from 'react'

import { useAnnounce } from './Announcer.js'
import { useClientEvents } from './hooks.js'
import { describeShare } from './Share.js'
import type { CallMedia } from './useCall.js'

/**
 * What the share looks like on this screen, and what happens to the view when one
 * starts.
 *
 * Who is sharing comes from the **call** rather than from anybody's device flags,
 * because the call holds one slot and asking it is how every screen in the room
 * agrees about whose screen is on them. The stream comes from the adapter, like
 * every other stream, so nothing here knows which provider delivered it.
 */

export interface Share {
  /** Whoever is sharing in the room you are standing in, or nobody. */
  sharedBy: Sharer | null
  /** True when the share is this device's own, which is drawn differently. */
  mine: boolean
  /** The share itself, once it has arrived. Null while it is on its way. */
  stream: MediaStream | null
}

export interface UseShareOptions {
  /** Whether the call is filling the window, and how to change that. */
  callView: boolean
  setCallView(next: boolean): void
}

export function useShare(
  client: OfisClient,
  state: OfficeState,
  media: CallMedia,
  options: UseShareOptions,
): Share {
  const announce = useAnnounce()
  const roomId = yourRoom(state)
  const sharedBy = roomId ? sharerIn(state, roomId) : null
  const mine = sharedBy?.deviceId === state.you.deviceId

  const stream = !sharedBy
    ? null
    : mine
      ? media.local.screen
      : (media.peers.get(sharedBy.deviceId)?.screen ?? null)

  useShareView({ sharing: sharedBy !== null, ...options })

  /*
   * A share starting or stopping, said once.
   *
   * Politely: it is a change to what is on screen rather than something that needs
   * to interrupt whoever is talking. Named, because "somebody is sharing" is no use
   * in a room of four people — and said at all because a screen appearing is
   * invisible to exactly the person who most needs to know it happened.
   */
  const said = useRef<Sharer | null>(null)
  const yourDeviceId = state.you.deviceId
  useEffect(() => {
    const before = said.current
    // The same share, reported again by another diff: the slot is identified by who
    // holds it and since when, so a re-render is not an event.
    if (before?.deviceId === sharedBy?.deviceId && before?.startedAt === sharedBy?.startedAt) {
      return
    }
    said.current = sharedBy

    // Both sentences are said when one share replaces another, because both things
    // happened: one screen went away and a different one arrived.
    if (before && before.deviceId !== yourDeviceId && before.displayName) {
      announce(describeShare(before.displayName, false))
    }
    // Never your own: the banner already says it, and announcing it would be
    // telling somebody what they just did.
    if (sharedBy && sharedBy.deviceId !== yourDeviceId && sharedBy.displayName) {
      announce(describeShare(sharedBy.displayName, true))
    }
  }, [announce, sharedBy, yourDeviceId])

  /*
   * Your own share being taken over, said assertively.
   *
   * The one share message that interrupts, because it is the one that changes what
   * the person is doing rather than what they are looking at: somebody who thinks
   * they are still presenting will carry on talking about a screen nobody can see.
   */
  useClientEvents(
    client,
    useCallback(
      (event) => {
        if (event.type !== 'share.ended') return
        const who = state.people.get(event.byUserId)?.displayName
        announce(
          who
            ? `${who} is sharing now, so your screen share stopped.`
            : 'Somebody else is sharing now, so your screen share stopped.',
          'assertive',
        )
      },
      [announce, state.people],
    ),
  )

  return { sharedBy, mine, stream }
}

/**
 * Everybody's view follows the share, and then gives itself back.
 *
 * A share is the one thing in the office that is worth interrupting a layout for:
 * somebody has put something on screen to be looked at, and a person sitting in map
 * view would otherwise never see it. So every client switches to the call, and when
 * the share ends every client goes back to whatever it was doing — which is the half
 * that makes the switch acceptable rather than annoying.
 *
 * **A default and not a lock.** Switching back to the map during a share is allowed
 * and is remembered: the layout is only restored for somebody who stayed where they
 * were put, because restoring it for anybody else would be overriding a choice they
 * made a moment ago.
 */
export function useShareView(options: {
  sharing: boolean
  callView: boolean
  setCallView(next: boolean): void
}): void {
  const { sharing, callView, setCallView } = options

  /** What the view was before the share, or null when no share is running. */
  const saved = useRef<boolean | null>(null)
  /** Whether a share was running last time this ran, so only changes act. */
  const was = useRef(false)

  useEffect(() => {
    /*
     * Only the two moments that matter: a share starting and a share ending.
     *
     * The current view is a dependency because the effect reads it, and the guard is
     * what keeps that from mattering: somebody changing their own view mid-share runs
     * this again and it does nothing, which is the whole of "a default, not a lock".
     */
    if (sharing === was.current) return
    was.current = sharing

    if (sharing) {
      saved.current = callView
      if (!callView) setCallView(true)
      return
    }

    if (saved.current === null) return
    const previous = saved.current
    saved.current = null
    // Their own choice stands. Somebody who went back to the map during the share has
    // already said what they want to be looking at.
    if (callView) setCallView(previous)
  }, [callView, sharing, setCallView])
}
