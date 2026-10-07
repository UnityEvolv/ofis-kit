import type { ClientEvent, OfficeState, OfisClient } from '@unityevolv/ofiskit-realtime-client'
import { you as yourPresence } from '@unityevolv/ofiskit-realtime-client'
import { useCallback, useEffect, useState } from 'react'

import { useClientEvents } from './hooks.js'

/**
 * The nudges on this screen, and when each may be shown.
 *
 * A nudge is never stored anywhere: it arrives on the socket, lives here, and is
 * gone when it is dismissed or the page closes. The one rule this hook exists for
 * is the call: a nudge that arrives while you are in one — the server says so
 * with `delivery: 'held'`, and this screen double-checks against your own state —
 * waits quietly as a count, and is shown once, as an ordinary notice, when the
 * call is over. Interrupting a call with a tap on the shoulder is exactly what
 * must not happen.
 *
 * No strings here, so a host drawing its own notices in its own language uses
 * this unchanged and only the drawing differs.
 */

export interface IncomingNudge {
  nudgeId: string
  userId: string
  displayName: string
  photoUrl?: string
  /** Where they were when they nudged, so "join them" is one move. */
  roomId: string
  line?: string
  at: string
}

export interface Nudges {
  /** On screen now, newest last. One per person: a second from them replaces the first. */
  shown: IncomingNudge[]
  /** Waiting for your call to end. Drawn as a count, never as a notice. */
  held: IncomingNudge[]
  dismiss(nudgeId: string): void
}

export interface UseNudgesOptions {
  /**
   * Told about each nudge as it becomes visible — on arrival, or when a call it
   * waited for ends — so the host can announce it and play its sound. Never for a
   * held one: that is the point of holding it.
   */
  onShow?(nudge: IncomingNudge): void
  /** Told about each nudge that arrives held, so the host can say so quietly. */
  onHold?(nudge: IncomingNudge): void
}

const asNudge = (event: Extract<ClientEvent, { type: 'nudge' }>): IncomingNudge => ({
  nudgeId: event.nudgeId,
  userId: event.userId,
  displayName: event.displayName,
  ...(event.photoUrl ? { photoUrl: event.photoUrl } : {}),
  roomId: event.roomId,
  ...(event.line ? { line: event.line } : {}),
  at: event.at,
})

/** One per sender: the newest from somebody replaces what they sent before. */
const withNudge = (list: IncomingNudge[], nudge: IncomingNudge): IncomingNudge[] => [
  ...list.filter((one) => one.userId !== nudge.userId),
  nudge,
]

export function useNudges(
  client: OfisClient,
  state: OfficeState,
  options: UseNudgesOptions = {},
): Nudges {
  const [shown, setShown] = useState<IncomingNudge[]>([])
  const [held, setHeld] = useState<IncomingNudge[]>([])
  // Busy is a call here or a meeting elsewhere: the two statuses a nudge waits out.
  const status = yourPresence(state)?.status
  const inCall = status === 'in_call' || status === 'in_meeting'
  const { onShow, onHold } = options

  useClientEvents(
    client,
    useCallback(
      (event: ClientEvent) => {
        if (event.type !== 'nudge') return
        const nudge = asNudge(event)
        if (event.delivery === 'held' || inCall) {
          setHeld((current) => withNudge(current, nudge))
          onHold?.(nudge)
          return
        }
        setShown((current) => withNudge(current, nudge))
        onShow?.(nudge)
      },
      [inCall, onHold, onShow],
    ),
  )

  /*
   * The call is over: everything that waited is shown, once.
   *
   * Once because it moves from one list to the other; a second call does not
   * bring it back, and dismissing it is final.
   */
  const [wasInCall, setWasInCall] = useState(inCall)
  const [released, setReleased] = useState<IncomingNudge[]>([])
  if (wasInCall !== inCall) {
    // Adjusted while rendering rather than in an effect, which is React's own
    // pattern for state that follows a change in what was passed in.
    setWasInCall(inCall)
    if (!inCall && held.length > 0) {
      setShown((current) => held.reduce(withNudge, current))
      setReleased(held)
      setHeld([])
    }
  }

  // Said once each, as they appear: the host announces them and plays nothing.
  useEffect(() => {
    for (const nudge of released) onShow?.(nudge)
  }, [released, onShow])

  const dismiss = useCallback((nudgeId: string) => {
    setShown((current) => current.filter((one) => one.nudgeId !== nudgeId))
  }, [])

  return { shown, held, dismiss }
}
