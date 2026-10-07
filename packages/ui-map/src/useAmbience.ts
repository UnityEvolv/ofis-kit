import type { AmbienceTrack } from '@unityevolv/ofiskit-template'
import { useCallback, useEffect, useRef, useState } from 'react'

import { createAmbiencePlayer, type AmbiencePlayer } from './ambience.js'

/**
 * When the room's loop plays, and when it does not.
 *
 * The engine plays at the volume it is given and never decides whether the
 * person wants it: that is the host's, from a profile in unityofis and from this
 * browser in the free app. The seam is `enabled`, and false is absolute —
 * nothing loads and nothing plays, whatever the room or the office says.
 *
 * The other rules:
 * - it fades out when you join a call and back when you leave it (`suspended`);
 * - it dips under a knock or a chime (`duck`, wired to `useSounds`);
 * - a browser that wants a gesture first gets one asked for, not worked around:
 *   the status says `blocked` and the indicator offers to start it. After that
 *   press it follows the person's setting for the rest of the session.
 */

export type AmbienceStatus =
  /** The room has no loop. Nothing to show. */
  | 'silent'
  /** The room has a loop and the person has ambience off. Shown, so they know what others hear. */
  | 'off'
  /** In a call: faded out until it ends. */
  | 'paused'
  /** Waiting for a press before the browser will play anything. */
  | 'blocked'
  | 'loading'
  | 'playing'
  /** The loop could not be fetched or decoded. Shown rather than retried in a loop. */
  | 'unavailable'

export interface UseAmbienceOptions {
  /** The loop for the room you are in, or null when it is silent. See `roomTrack`. */
  track: AmbienceTrack | null
  /** The person's switch. False is absolute. */
  enabled: boolean
  /** 0..1, as the person set it. */
  volume: number
  /** True while you are in a call. */
  suspended: boolean
  /** The speaker chosen for calls, so the loop comes out of the same place. */
  speakerDeviceId?: string
  /** Injected in tests; the browser's own player otherwise. */
  player?: AmbiencePlayer
}

export interface Ambience {
  status: AmbienceStatus
  track: AmbienceTrack | null
  /** Start it from a press, where the browser asked for one. */
  start(): void
  /** Dip under a notification sound. Pass to `useSounds` as `onSound`. */
  duck(): void
}

export function useAmbience(options: UseAmbienceOptions): Ambience {
  const { track, enabled, volume, suspended, speakerDeviceId } = options
  const injected = options.player
  const player = useRef<AmbiencePlayer | null>(null)
  const ensure = useCallback((): AmbiencePlayer => {
    player.current ??= injected ?? createAmbiencePlayer()
    return player.current
  }, [injected])

  // Bumped by a press, so the effect below asks again now that it may.
  const [unlocked, setUnlocked] = useState(0)
  const src = track?.src ?? null
  const wanted = src !== null && enabled && !suspended
  const request = `${src ?? ''}#${unlocked}`

  /*
   * What the last request came to, keyed by the request, so a new room reads as
   * loading until its own answer arrives rather than borrowing the last one's.
   */
  const [answer, setAnswer] = useState<{
    request: string
    result: 'playing' | 'blocked' | 'unavailable'
  } | null>(null)

  const volumeNow = useRef(volume)
  useEffect(() => {
    volumeNow.current = volume
    player.current?.setVolume(volume)
  }, [volume])

  useEffect(() => {
    if (!wanted || src === null) {
      player.current?.stop()
      return
    }
    let current = true
    void ensure()
      .play(src, volumeNow.current)
      .then((result) => {
        if (current) setAnswer({ request, result: result === 'failed' ? 'unavailable' : result })
      })
    return () => {
      current = false
    }
  }, [ensure, request, src, wanted])

  useEffect(() => {
    player.current?.useSpeaker(speakerDeviceId)
  }, [speakerDeviceId])

  // The session ends with the component; the loop goes with it.
  useEffect(
    () => () => {
      player.current?.close()
      player.current = null
    },
    [],
  )

  const start = useCallback(() => {
    void ensure()
      .unlock()
      .then((allowed) => {
        if (allowed) setUnlocked((count) => count + 1)
      })
  }, [ensure])

  const duck = useCallback(() => player.current?.duck(), [])

  const status: AmbienceStatus =
    track === null
      ? 'silent'
      : !enabled
        ? 'off'
        : suspended
          ? 'paused'
          : answer?.request === request
            ? answer.result
            : 'loading'

  return { status, track, start, duck }
}
