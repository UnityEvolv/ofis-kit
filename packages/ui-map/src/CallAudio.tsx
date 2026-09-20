import type { OfisClient } from '@unityevolv/ofiskit-realtime-client'
import { useEffect, useRef, useState } from 'react'

import { useClientEvents } from './hooks.js'

/**
 * Where the other people's voices actually come out.
 *
 * Easy to forget, and invisible when it is missing: the peer connections succeed,
 * the tiles appear, the indicators move, and nobody can hear anybody. A stream
 * that is never attached to an element is a stream the browser does not play.
 *
 * Deliberately separate from the video tiles. Audio must keep playing when a tile
 * is paged out of the visible set, when somebody has no camera, and before any
 * tile exists at all — the conversation is the point, and the picture is not.
 *
 * One element per peer rather than one mixed element, because output routing is
 * per element: that is what lets a call go to headphones while system sounds stay
 * on the speakers.
 */

export interface CallAudioProps {
  client: OfisClient
  /** The chosen speaker. Empty follows the operating system. */
  speakerDeviceId?: string
}

/**
 * Route one element to a speaker, where the browser can.
 *
 * The DOM types declare `setSinkId` as always present; the browsers do not. Safari
 * has never had it, and a mobile browser lets the operating system decide — which
 * is the right answer on a phone anyway. So a missing method means the system
 * default rather than a failure, and that is exactly what somebody who has not
 * chosen a speaker wants.
 */
function routeTo(element: HTMLAudioElement, speakerDeviceId: string): void {
  if (typeof element.setSinkId !== 'function') return
  void element.setSinkId(speakerDeviceId).catch(() => {})
}

export function CallAudio({ client, speakerDeviceId }: CallAudioProps) {
  const [streams, setStreams] = useState<Map<string, MediaStream>>(new Map())
  const elements = useRef(new Map<string, HTMLAudioElement>())

  useClientEvents(client, (event) => {
    if (event.type !== 'rtc') return

    if (event.event.type === 'track' && event.event.source === 'audio') {
      const { deviceId, stream } = event.event
      setStreams((current) => new Map(current).set(deviceId, stream))
    }

    // A leg that has gone takes its element with it, or a call that ends leaves
    // elements holding dead streams.
    if (event.event.type === 'participant.left') {
      const { deviceId } = event.event
      setStreams((current) => {
        if (!current.has(deviceId)) return current
        const next = new Map(current)
        next.delete(deviceId)
        return next
      })
    }
  })

  /*
   * Route every element to the chosen speaker.
   *
   * In an effect rather than as an attribute, because `setSinkId` is a method and
   * a promise, and it is unavailable on Safari and on mobile — where the
   * operating system decides, which is the right answer on a phone anyway. A
   * failure here is silently the system default, which is exactly what somebody
   * who has not chosen a speaker wants.
   */
  useEffect(() => {
    if (!speakerDeviceId) return
    for (const element of elements.current.values()) routeTo(element, speakerDeviceId)
  }, [speakerDeviceId, streams])

  return (
    <>
      {[...streams].map(([deviceId, stream]) => (
        <audio
          key={deviceId}
          autoPlay
          // Never muted, and never `controls`: this is not a player, it is the
          // reason the call is audible. A muted audio element is the single
          // easiest way to ship a call nobody can hear.
          data-testid={`call-audio-${deviceId}`}
          ref={(element) => {
            if (!element) {
              elements.current.delete(deviceId)
              return
            }
            elements.current.set(deviceId, element)
            if (element.srcObject !== stream) element.srcObject = stream
            if (speakerDeviceId) routeTo(element, speakerDeviceId)
          }}
        />
      ))}
    </>
  )
}
