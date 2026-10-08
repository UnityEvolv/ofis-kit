import type {
  ClientEvent,
  FollowEndReason,
  OfficeState,
  OfisClient,
  PublicPresence,
} from '@unityevolv/ofiskit-realtime-client'
import { followOf } from '@unityevolv/ofiskit-realtime-client'
import {
  useAnnounce,
  useClientEvents,
  useFollow,
  useNudges,
  type Following,
  type HostAction,
  type IncomingFollowRequest,
  type IncomingNudge,
  type Nudges,
} from '@unityevolv/ofiskit-ui-map'
import type { Template } from '@unityevolv/ofiskit-template'
import { useCallback, useState } from 'react'

/**
 * Nudging and following, for this app.
 *
 * Like the knock flow, it sits in the app rather than the map package because it
 * is a conversation between the socket, the notices and the moves that follow
 * them. The map package draws; the order of things — and what is said out loud
 * at each step — is written down here.
 */

export interface NudgeFollow {
  nudges: Nudges
  following: Following
  /** Whom the nudge dialog is open for, if anybody. */
  composing: PublicPresence | null
  closeComposer(): void
  sendNudge(line: string | undefined): void
  /** The actions on a person's card: nudge, and follow or stop. */
  actionsFor(person: PublicPresence): HostAction[]
  joinNudger(nudge: IncomingNudge): void
  accept(requestId: string): void
  decline(requestId: string): void
  stopFollowing(): void
  removeFollower(userId: string): void
  nameOf(userId: string): string
  roomName(roomId: string): string
}

/** Why each ending is worth a sentence, said to the person it happened to. */
function endedLine(reason: FollowEndReason, mine: boolean, name: string): string {
  if (mine) {
    switch (reason) {
      case 'stopped':
        return `You stopped following ${name}.`
      case 'removed':
        return `${name} stopped you following them.`
      case 'moved_away':
        return `You walked off, so you are no longer following ${name}.`
      case 'left':
        return `${name} left, so you are no longer following them.`
      case 'call':
        return `You stayed in your call, so you are no longer following ${name}.`
    }
  }
  return `${name} is no longer following you.`
}

export function useNudgeFollow(
  client: OfisClient,
  state: OfficeState,
  template: Template,
): NudgeFollow {
  const announce = useAnnounce()
  const [composing, setComposing] = useState<PublicPresence | null>(null)

  const nameOf = useCallback(
    (userId: string) => state.people.get(userId)?.displayName ?? 'Somebody',
    [state.people],
  )
  const roomName = useCallback(
    (roomId: string) => template.rooms.find((one) => one.id === roomId)?.name ?? 'a room',
    [template.rooms],
  )

  const nudges = useNudges(client, state, {
    onShow: useCallback(
      (nudge: IncomingNudge) =>
        announce(`${nudge.displayName} nudged you${nudge.line ? `: ${nudge.line}` : '.'}`),
      [announce],
    ),
    onHold: useCallback(
      (nudge: IncomingNudge) =>
        announce(`${nudge.displayName} nudged you. You will see it after your call.`),
      [announce],
    ),
  })

  const following = useFollow(client, state, {
    onRequest: useCallback(
      (request: IncomingFollowRequest) =>
        announce(`${request.displayName} would like to follow you.`, 'assertive'),
      [announce],
    ),
  })

  const self = state.you.userId

  useClientEvents(
    client,
    useCallback(
      (event: ClientEvent) => {
        if (event.type === 'follow.moved') {
          announce(`You followed ${nameOf(event.leaderId)} into ${roomName(event.roomId)}.`)
          return
        }
        if (event.type === 'follow.held') {
          announce(`${event.message} You are still following ${nameOf(event.leaderId)}.`)
          return
        }
        if (event.type === 'follow.ended') {
          const mine = event.followerId === self
          const other = mine ? event.leaderId : event.followerId
          announce(endedLine(event.reason, mine, nameOf(other)))
          return
        }
        if (event.type === 'follow.resolved') {
          const asking = followOf(state).asking
          if (asking?.requestId !== event.requestId) return
          const name = nameOf(asking.userId)
          if (event.outcome === 'declined') announce(`${name} said not now.`)
          if (event.outcome === 'expired') announce(`${name} did not answer.`)
          if (event.outcome === 'accepted') announce(`You are following ${name}.`)
        }
      },
      [announce, nameOf, roomName, self, state],
    ),
  )

  const sendNudge = useCallback(
    (line: string | undefined) => {
      const target = composing
      setComposing(null)
      if (!target) return
      // A refusal is announced by the page, as every refusal is.
      void client.nudge(target.userId, line).then((result) => {
        if (!result.ok) return
        announce(
          result.delivery === 'held'
            ? `${target.displayName} is in a call, and will see your nudge when it ends.`
            : `Nudged ${target.displayName}.`,
        )
      })
    },
    [announce, client, composing],
  )

  const follow = followOf(state)

  const actionsFor = useCallback(
    (person: PublicPresence): HostAction[] => {
      if (person.userId === self) return []
      const name = person.displayName
      const dnd = person.status === 'dnd'
      const nudgeReason = dnd
        ? `${name} is on do not disturb.`
        : person.status === 'away'
          ? `${name} is away.`
          : person.status === 'offline' || person.status === 'reconnecting'
            ? `${name} is not connected.`
            : null

      const followAction: HostAction =
        follow.following?.userId === person.userId
          ? {
              id: 'follow',
              label: 'Stop following',
              onSelect: () => void client.stopFollowing(),
            }
          : follow.followers.some((one) => one.userId === person.userId)
            ? {
                id: 'follow',
                label: 'Stop them following you',
                onSelect: () => void client.removeFollower(person.userId),
              }
            : {
                id: 'follow',
                label: 'Ask to follow',
                disabled: dnd
                  ? `${name} is on do not disturb.`
                  : follow.following
                    ? 'You are already following somebody.'
                    : follow.followers.length > 0
                      ? 'People are following you, so you cannot follow anybody.'
                      : null,
                onSelect: () =>
                  void client.requestFollow(person.userId).then((result) => {
                    if (!result.ok) return
                    announce(
                      result.following
                        ? `You are following ${name}.`
                        : `Asked ${name} if you can follow them.`,
                    )
                  }),
              }

      return [
        {
          id: 'nudge',
          label: 'Nudge',
          disabled: nudgeReason,
          onSelect: () => setComposing(person),
        },
        followAction,
      ]
    },
    [announce, client, follow, self],
  )

  const joinNudger = useCallback(
    (nudge: IncomingNudge) => {
      nudges.dismiss(nudge.nudgeId)
      void client.joinRoom(nudge.roomId).then((result) => {
        if (result.ok) announce(`You are in ${roomName(nudge.roomId)}.`)
      })
    },
    [announce, client, nudges, roomName],
  )

  const accept = useCallback(
    (requestId: string) => {
      following.settle(requestId)
      void client.acceptFollow(requestId)
    },
    [client, following],
  )
  const decline = useCallback(
    (requestId: string) => {
      following.settle(requestId)
      void client.declineFollow(requestId)
    },
    [client, following],
  )

  return {
    nudges,
    following,
    composing,
    closeComposer: () => setComposing(null),
    sendNudge,
    actionsFor,
    joinNudger,
    accept,
    decline,
    stopFollowing: () => void client.stopFollowing(),
    removeFollower: (userId: string) => void client.removeFollower(userId),
    nameOf,
    roomName,
  }
}
