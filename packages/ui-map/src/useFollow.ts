import type {
  ClientEvent,
  FollowState,
  OfficeState,
  OfisClient,
} from '@unityevolv/ofiskit-realtime-client'
import { followOf } from '@unityevolv/ofiskit-realtime-client'
import { useCallback, useState } from 'react'

import type { IncomingFollowRequest } from './Follow.js'
import { useClientEvents } from './hooks.js'

/**
 * Following on this screen: your side of it, and the requests waiting on you.
 *
 * Your side comes from the office state, where the client keeps it from the
 * snapshot and every change after — so it is right after a reload. The requests
 * are events, held here until each is answered, withdrawn or lapses, and removed
 * from every screen of yours when any of them answers.
 *
 * No strings, like `useNudges`: a host announcing in its own language uses this
 * unchanged.
 */
export interface Following {
  follow: FollowState
  requests: IncomingFollowRequest[]
  /** Take a request off this screen at once, ahead of the server's word. */
  settle(requestId: string): void
}

export interface UseFollowOptions {
  /** Told about each request as it arrives, so the host can announce it. */
  onRequest?(request: IncomingFollowRequest): void
}

export function useFollow(
  client: OfisClient,
  state: OfficeState,
  options: UseFollowOptions = {},
): Following {
  const [requests, setRequests] = useState<IncomingFollowRequest[]>([])
  const { onRequest } = options

  useClientEvents(
    client,
    useCallback(
      (event: ClientEvent) => {
        if (event.type === 'follow.requested') {
          const request: IncomingFollowRequest = {
            requestId: event.requestId,
            userId: event.userId,
            displayName: event.displayName,
            ...(event.photoUrl ? { photoUrl: event.photoUrl } : {}),
          }
          setRequests((current) => [
            ...current.filter((one) => one.userId !== request.userId),
            request,
          ])
          onRequest?.(request)
          return
        }
        if (event.type === 'follow.resolved') {
          setRequests((current) => current.filter((one) => one.requestId !== event.requestId))
        }
      },
      [onRequest],
    ),
  )

  const settle = useCallback((requestId: string) => {
    setRequests((current) => current.filter((one) => one.requestId !== requestId))
  }, [])

  return { follow: followOf(state), requests, settle }
}
