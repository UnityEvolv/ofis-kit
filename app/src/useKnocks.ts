import type { OfisClient } from '@unityevolv/ofiskit-realtime-client'
import { yourRoom } from '@unityevolv/ofiskit-realtime-client'
import { useAnnounce, useClientEvents } from '@unityevolv/ofiskit-ui-map'
import type { IncomingKnock, KnockOutcome } from '@unityevolv/ofiskit-ui-map'
import type { Template } from '@unityevolv/ofiskit-template'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The whole knock flow, in one place.
 *
 * It sits in the app rather than in the map package because it is a conversation
 * between three things — the socket, the two cards, and the move that follows
 * being let in — and the map package's job is to draw. A wrapper hosting the same
 * components can arrange them differently; what it cannot do differently is the
 * order below, which is why the order is what is written down here.
 */

export interface OutgoingState {
  roomId: string
  roomName: string
  outcome: KnockOutcome
  message?: string | null
  silent?: boolean
}

export interface Knocks {
  /** Knocks waiting on the room you are in. Nothing else is ever shown. */
  incoming: IncomingKnock[]
  /** Your own knock, and how it ended. */
  outgoing: OutgoingState | null
  knock(roomId: string): void
  admit(knockId: string): void
  decline(knockId: string): void
  dismiss(): void
}

export function useKnocks(client: OfisClient, template: Template): Knocks {
  const announce = useAnnounce()
  const [incoming, setIncoming] = useState<IncomingKnock[]>([])
  const [outgoing, setOutgoing] = useState<OutgoingState | null>(null)

  /*
   * Read inside the socket handler, which must not be re-made on every state
   * change, because re-making it would re-subscribe the listener underneath.
   *
   * Written in an effect rather than during render: a render React throws away
   * must not be able to change what a live subscription will see. The handler
   * only ever runs from a socket event, by which time the effect has run.
   */
  const latest = useRef(outgoing)
  useEffect(() => {
    latest.current = outgoing
  }, [outgoing])

  const nameOf = useCallback(
    (roomId: string) => template.rooms.find((one) => one.id === roomId)?.name ?? 'the room',
    [template.rooms],
  )

  const dismiss = useCallback(() => setOutgoing(null), [])

  useClientEvents(
    client,
    useCallback(
      (event) => {
        if (event.type === 'knock') {
          setIncoming((current) =>
            // One card per person per room. Knocking again is impatience, and the
            // engine replaces the knock rather than adding one, so the card does
            // the same.
            [...current.filter((one) => one.userId !== event.userId), event],
          )

          // Assertive, unlike almost everything else: somebody is standing
          // outside the door waiting for an answer.
          announce(`${event.displayName} is knocking.`, 'assertive')
          return
        }

        if (event.type === 'knock.resolved') {
          setIncoming((current) => current.filter((one) => one.knockId !== event.knockId))

          // Only your own knock's outcome goes in the outgoing card. The same
          // event reaches the room, where it means "that card is gone".
          if (latest.current && event.outcome !== 'admitted') {
            setOutgoing({ ...latest.current, outcome: event.outcome })
            announce(
              event.outcome === 'declined'
                ? `Not right now.`
                : `Nobody answered in ${latest.current.roomName}.`,
            )
          }
          return
        }

        if (event.type === 'admitted') {
          const name = nameOf(event.roomId)
          setOutgoing({ roomId: event.roomId, roomName: name, outcome: 'admitted' })
          announce(`You were let into ${name}.`, 'assertive')

          /*
           * An invitation to move, not a reservation.
           *
           * So the move is a separate request, and it can still be refused —
           * because the room may have filled in the moment between being let in
           * and walking in. Nothing was held open, and `joinRoom` announces its
           * own refusal.
           */
          void client.joinRoom(event.roomId)
        }
      },
      [announce, client, nameOf],
    ),
  )

  const knock = useCallback(
    (roomId: string) => {
      const roomName = nameOf(roomId)
      setOutgoing({ roomId, roomName, outcome: 'waiting' })

      void client.knock(roomId).then((result) => {
        if (!result.ok) {
          // Rate limited, or a room that is not locked any more. Either way the
          // reason is shown rather than the knock disappearing.
          setOutgoing({ roomId, roomName, outcome: 'refused', message: result.message })
          announce(result.message, 'assertive')
          return
        }
        setOutgoing({ roomId, roomName, outcome: 'waiting', silent: result.silent })
      })
    },
    [announce, client, nameOf],
  )

  const admit = useCallback(
    (knockId: string) => {
      const knocker = incoming.find((one) => one.knockId === knockId)
      setIncoming((current) => current.filter((one) => one.knockId !== knockId))
      void client.admit(knockId)
      if (knocker) announce(`${knocker.displayName} was let in.`)
    },
    [announce, client, incoming],
  )

  const decline = useCallback(
    (knockId: string) => {
      setIncoming((current) => current.filter((one) => one.knockId !== knockId))
      void client.decline(knockId)
    },
    [client],
  )

  /*
   * Only knocks on the room you are standing in.
   *
   * The engine already sends them only to people inside, and this is the second
   * half of the same rule: somebody who walks out mid-knock should not still be
   * holding a card for a door they are no longer behind.
   */
  const here = yourRoom(client.state())
  const mine = incoming.filter((one) => one.roomId === here)

  return { incoming: mine, outgoing, knock, admit, decline, dismiss }
}
