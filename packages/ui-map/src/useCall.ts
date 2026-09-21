import type { OfisClient, PublicPresence, RtcEvent } from '@unityevolv/ofiskit-realtime-client'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'

import { useClientEvents } from './hooks.js'

/**
 * Everything the call UI needs, gathered from the adapter's events.
 *
 * The tiles, the controls and the indicators all read from here, and none of them
 * knows which provider is behind it. That is the point of the adapter emitting one
 * shape: swapping the built-in mesh for somebody's SFU changes nothing in this
 * file or in anything that uses it.
 */

export interface PeerMedia {
  camera?: MediaStream
  screen?: MediaStream
  audio?: MediaStream
}

export interface PeerQuality {
  relayed: boolean
  packetLoss: number
  roundTripMs: number
}

export interface CallMedia {
  /** Remote streams, by device. */
  peers: Map<string, PeerMedia>
  /** Your own camera and share, for your own tile and the sharing indicator. */
  local: { camera: MediaStream | null; screen: MediaStream | null }
  quality: Map<string, PeerQuality>
  /** Peers you are muting for yourself only. Nobody else is affected. */
  mutedForMe: Set<string>
  /** Problems worth telling somebody about, newest last. */
  problems: Array<{ id: number; deviceId?: string; message: string }>
  /** Set when your own video was reduced or dropped, so nobody wonders why. */
  degraded: string | null
}

type Action =
  | { kind: 'rtc'; event: RtcEvent }
  | { kind: 'mute-for-me'; deviceId: string; muted: boolean }
  | { kind: 'dismiss'; id: number }

const EMPTY: CallMedia = {
  peers: new Map(),
  local: { camera: null, screen: null },
  quality: new Map(),
  mutedForMe: new Set(),
  problems: [],
  degraded: null,
}

let problemId = 0

function reduce(state: CallMedia, action: Action): CallMedia {
  switch (action.kind) {
    case 'mute-for-me': {
      const mutedForMe = new Set(state.mutedForMe)
      if (action.muted) mutedForMe.add(action.deviceId)
      else mutedForMe.delete(action.deviceId)
      return { ...state, mutedForMe }
    }

    case 'dismiss':
      return { ...state, problems: state.problems.filter((problem) => problem.id !== action.id) }

    case 'rtc': {
      const event = action.event

      switch (event.type) {
        case 'track': {
          const peers = new Map(state.peers)
          peers.set(event.deviceId, { ...peers.get(event.deviceId), [event.source]: event.stream })
          return { ...state, peers }
        }

        case 'track.ended': {
          const peers = new Map(state.peers)
          const media = { ...peers.get(event.deviceId) }
          delete media[event.source]
          peers.set(event.deviceId, media)
          return { ...state, peers }
        }

        case 'participant.left': {
          const peers = new Map(state.peers)
          const quality = new Map(state.quality)
          peers.delete(event.deviceId)
          quality.delete(event.deviceId)
          // Muting somebody for yourself does not survive them leaving, and does
          // not persist across calls: the next one starts clean.
          const mutedForMe = new Set(state.mutedForMe)
          mutedForMe.delete(event.deviceId)
          return { ...state, peers, quality, mutedForMe }
        }

        case 'quality': {
          const quality = new Map(state.quality)
          quality.set(event.deviceId, {
            relayed: event.relayed,
            packetLoss: event.packetLoss,
            roundTripMs: event.roundTripMs,
          })
          return { ...state, quality }
        }

        case 'local':
          return { ...state, local: { ...state.local, [event.source]: event.stream } }

        case 'failed': {
          problemId += 1
          return {
            ...state,
            problems: [
              ...state.problems,
              {
                id: problemId,
                ...(event.deviceId ? { deviceId: event.deviceId } : {}),
                message: event.reason,
              },
            ],
          }
        }

        case 'degraded':
          return { ...state, degraded: event.reason }

        default:
          return state
      }
    }
  }
}

export function useCallMedia(client: OfisClient): CallMedia & {
  muteForMe(deviceId: string, muted: boolean): void
  dismiss(id: number): void
} {
  const [state, dispatch] = useReducer(reduce, EMPTY)

  useEffect(
    () =>
      client.rtc.on((event) => {
        dispatch({ kind: 'rtc', event })
      }),
    [client],
  )

  return useMemo(
    () => ({
      ...state,
      muteForMe: (deviceId: string, muted: boolean) =>
        dispatch({ kind: 'mute-for-me', deviceId, muted }),
      dismiss: (id: number) => dispatch({ kind: 'dismiss', id }),
    }),
    [state],
  )
}

/**
 * Who should be on screen, and in what order.
 *
 * **Raised hands first, in the order they went up**, then the most recent speaker,
 * then everybody else. Both halves matter for the same reason: only five tiles are
 * visible, so being last in this list means being paged off screen — and somebody
 * who has asked to speak is the last person who should disappear. Whoever asked
 * first is listed first, because the queue is the whole value of a raised hand.
 *
 * The ordering is a **pure function of the office state**. `lastSpokeAt` and
 * `handRaisedAt` are both stamped by the server, so everybody in the call sees the
 * same five faces in the same order — a client that joined a minute ago has no
 * less idea of who spoke recently, or who asked first, than one that has been
 * listening throughout.
 */
export function speakerOrder(
  participants: ReadonlyArray<{ userId: string; deviceId: string }>,
  people: ReadonlyMap<string, PublicPresence>,
): string[] {
  const legOf = (deviceId: string, userId: string) =>
    people.get(userId)?.devices.find((one) => one.deviceId === deviceId)

  return participants
    .map((one) => {
      const leg = legOf(one.deviceId, one.userId)
      return {
        ...one,
        raisedAt: leg?.handRaisedAt ? Date.parse(leg.handRaisedAt) : null,
        spokeAt: leg?.lastSpokeAt ? Date.parse(leg.lastSpokeAt) : 0,
      }
    })
    .sort((a, b) => {
      // A hand up outranks anything anybody has said, and the earlier hand
      // outranks the later one. Compared as two nullable values rather than by
      // sorting on a number, because "no hand" is not a time and arithmetic on a
      // sentinel is how an ordering like this quietly goes wrong.
      if (a.raisedAt !== null && b.raisedAt !== null) {
        if (a.raisedAt !== b.raisedAt) return a.raisedAt - b.raisedAt
      } else if (a.raisedAt !== null) return -1
      else if (b.raisedAt !== null) return 1

      if (a.spokeAt !== b.spokeAt) return b.spokeAt - a.spokeAt
      // A stable tie-break, so people who have never spoken keep their places
      // rather than shuffling on every render.
      return a.deviceId.localeCompare(b.deviceId)
    })
    .map((one) => one.deviceId)
}

/**
 * How long a reaction floats before it is gone.
 *
 * Long enough to be seen across a room full of tiles, short enough that two in a
 * row do not stack into a wall. Nothing is stored anywhere: when this elapses the
 * reaction has not been archived, it has stopped existing.
 */
export const REACTION_VISIBLE_MS = 4_000

/** One reaction, in the air. */
export interface LiveReaction {
  /** Local, and only so React can key two identical emoji apart. */
  id: number
  userId: string
  deviceId: string
  reaction: string
}

let reactionId = 0

const groupBy = (
  reactions: readonly LiveReaction[],
  key: 'userId' | 'deviceId',
): Map<string, LiveReaction[]> => {
  const grouped = new Map<string, LiveReaction[]>()
  for (const one of reactions) {
    const list = grouped.get(one[key])
    if (list) list.push(one)
    else grouped.set(one[key], [one])
  }
  return grouped
}

/**
 * The reactions in the air right now.
 *
 * Held here and nowhere else — not in the office state, not on the server. A
 * reaction is an event, and treating it as state is how a product ends up with a
 * screen full of yesterday's applause.
 *
 * Grouped two ways because it is drawn in two places: over a tile, which is a
 * device, and over an avatar on the map, which is a person.
 */
export function useReactions(
  client: OfisClient,
  visibleMs: number = REACTION_VISIBLE_MS,
): { byDevice: ReadonlyMap<string, LiveReaction[]>; byUser: ReadonlyMap<string, LiveReaction[]> } {
  const [live, setLive] = useState<LiveReaction[]>([])
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())

  useClientEvents(
    client,
    useCallback(
      (event) => {
        if (event.type !== 'reaction') return

        reactionId += 1
        const id = reactionId
        setLive((current) => [
          ...current,
          {
            id,
            userId: event.userId,
            deviceId: event.deviceId,
            reaction: event.reaction,
          },
        ])

        const timer = setTimeout(() => {
          timers.current.delete(timer)
          setLive((current) => current.filter((one) => one.id !== id))
        }, visibleMs)
        timers.current.add(timer)
      },
      [visibleMs],
    ),
  )

  // Leaving the office mid-reaction must not leave a timer holding a setState for
  // a component that has gone.
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending) clearTimeout(timer)
      pending.clear()
    }
  }, [])

  return useMemo(
    () => ({ byDevice: groupBy(live, 'deviceId'), byUser: groupBy(live, 'userId') }),
    [live],
  )
}

/**
 * The order, held still for a moment after it changes.
 *
 * Two people trading short sentences would otherwise swap tiles constantly, which
 * is far more distracting than a tile being a beat out of date.
 *
 * The hold applies **only to re-ordering**: somebody joining or leaving is applied
 * at once, because a tile that is not there yet is worse than one in the wrong
 * place.
 */
export function useSpeakerOrder(
  participants: ReadonlyArray<{ userId: string; deviceId: string }>,
  people: ReadonlyMap<string, PublicPresence>,
  holdMs = 1500,
): string[] {
  const target = useMemo(() => speakerOrder(participants, people), [participants, people])

  /** Who is in the call, regardless of order. Changes when somebody comes or goes. */
  const membership = useMemo(() => [...target].sort().join(','), [target])

  const [shown, setShown] = useState(target)
  const [shownMembership, setShownMembership] = useState(membership)

  // Somebody arrived or left, so there is a tile to add or remove: applied during
  // this render rather than after it, because waiting a beat would show a call
  // that does not match who is in it.
  if (membership !== shownMembership) {
    setShownMembership(membership)
    setShown(target)
  }

  // The same people in a different order: held.
  useEffect(() => {
    if (shown.length === target.length && shown.every((id, index) => id === target[index])) return
    const timer = setTimeout(() => setShown(target), holdMs)
    return () => clearTimeout(timer)
  }, [target, shown, holdMs])

  return shown
}
