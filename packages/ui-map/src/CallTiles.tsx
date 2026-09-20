import { Icon } from '@unityevolv/unitykit'
import type { PublicPresence, RoomCall } from '@unityevolv/ofiskit-realtime-client'
import { useEffect, useRef, useState } from 'react'

import { useReducedMotion } from './hooks.js'
import { StatusDot } from './status.js'
import type { CallMedia } from './useCall.js'

/**
 * The tiles for the people in your call.
 *
 * Five at a time, whatever the size of the call, ordered by most recent speaker.
 * Both halves matter: the five bounds what each person downloads, and the ordering
 * makes sure the five are the ones worth seeing. Only visible tiles receive video;
 * everybody else is audio-only until they are paged to.
 *
 * **No audio here.** The voices come out of the one audio sink, which keeps
 * playing when a tile is paged out of the visible five, when somebody has no
 * camera, and in the office view where there are no tiles at all. A second
 * element on the same stream would be the same person, twice.
 *
 * Provider-independent: these take streams and speaking state from the shared
 * realtime client and never know whether a mesh or an SFU is behind them.
 */

/** Five across, or five down. The rule is the same in both orientations. */
export const TILES_VISIBLE = 5

export interface CallTilesProps {
  call: RoomCall
  /** Everybody in the office, by user, so a tile can find its person. */
  people: ReadonlyMap<string, PublicPresence>
  /** Ordered by most recent speaker. From `useSpeakerOrder`. */
  order: string[]
  media: CallMedia
  you: { userId: string; deviceId: string }
  /** A strip across the top, or a column down the right. The canvas shape decides. */
  placement: 'top' | 'right' | 'grid'
  onMuteForMe(deviceId: string, muted: boolean): void
  /** Tells the adapter which peers should be sending video. */
  onVisibleChange(deviceIds: string[]): void
}

export function CallTiles(props: CallTilesProps) {
  const { call, people, order, media, you, placement } = props
  const [page, setPage] = useState(0)

  // Your own tile is pinned at the front and is not one of the five, so seeing
  // yourself never costs somebody else their place.
  const others = order.filter((deviceId) => deviceId !== you.deviceId)
  const pages = Math.max(1, Math.ceil(others.length / TILES_VISIBLE))
  const current = Math.min(page, pages - 1)
  const visible = others.slice(current * TILES_VISIBLE, current * TILES_VISIBLE + TILES_VISIBLE)
  const offscreen = others.length - visible.length

  /*
   * Paging changes which video streams are received.
   *
   * Without this the five-tile rule would bound what is *drawn* and not what is
   * downloaded, which is the half that actually costs anything.
   */
  const key = visible.join(',')
  const notify = props.onVisibleChange
  useEffect(() => {
    notify(key ? key.split(',') : [])
  }, [key, notify])

  const column = placement === 'right'
  const grid = placement === 'grid'

  return (
    <section
      aria-label={`Call with ${call.participants.length} ${
        call.participants.length === 1 ? 'person' : 'people'
      }`}
      data-testid="call-tiles"
      data-placement={placement}
      className={[
        'flex gap-2 bg-base-200 p-2',
        grid
          ? 'h-full w-full flex-wrap content-center justify-center'
          : column
            ? 'h-full w-56 flex-col overflow-y-auto'
            : 'w-full flex-row overflow-x-auto',
      ].join(' ')}
    >
      <Tile
        deviceId={you.deviceId}
        person={people.get(you.userId)}
        stream={media.local.camera}
        you
        placement={placement}
        quality={null}
        mutedForMe={false}
        onMuteForMe={props.onMuteForMe}
      />

      {visible.map((deviceId) => {
        const participant = call.participants.find((one) => one.deviceId === deviceId)
        return (
          <Tile
            key={deviceId}
            deviceId={deviceId}
            person={participant ? people.get(participant.userId) : undefined}
            stream={media.peers.get(deviceId)?.camera}
            placement={placement}
            quality={media.quality.get(deviceId) ?? null}
            mutedForMe={media.mutedForMe.has(deviceId)}
            onMuteForMe={props.onMuteForMe}
          />
        )
      })}

      {pages > 1 && (
        <div
          className={[
            'flex shrink-0 items-center gap-1',
            column ? 'flex-row justify-center' : 'flex-col',
          ].join(' ')}
        >
          <button
            type="button"
            onClick={() => setPage(Math.max(0, current - 1))}
            disabled={current === 0}
            aria-label="Previous tiles"
            className="rounded p-1 hover:bg-base-300 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40"
          >
            <Icon name={column ? 'chevron-up' : 'chevron-left'} size="sm" />
          </button>

          {/* The count is the useful part: it says how many you are not seeing. */}
          <span className="text-[10px] tabular-nums text-base-content/70">
            {offscreen > 0 ? `+${offscreen}` : `${current + 1}/${pages}`}
          </span>

          <button
            type="button"
            onClick={() => setPage(Math.min(pages - 1, current + 1))}
            disabled={current >= pages - 1}
            aria-label="More tiles"
            className="rounded p-1 hover:bg-base-300 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40"
          >
            <Icon name={column ? 'chevron-down' : 'chevron-right'} size="sm" />
          </button>
        </div>
      )}
    </section>
  )
}

interface TileProps {
  deviceId: string
  person: PublicPresence | undefined
  stream?: MediaStream | null
  you?: boolean
  placement: 'top' | 'right' | 'grid'
  quality: { relayed: boolean; packetLoss: number; roundTripMs: number } | null
  mutedForMe: boolean
  onMuteForMe(deviceId: string, muted: boolean): void
}

function Tile({
  deviceId,
  person,
  stream,
  you,
  placement,
  quality,
  mutedForMe,
  onMuteForMe,
}: TileProps) {
  const video = useRef<HTMLVideoElement>(null)

  // Assigned imperatively: a MediaStream is not a URL and React has no prop for it.
  useEffect(() => {
    if (video.current) video.current.srcObject = stream ?? null
  }, [stream])

  const device = person?.devices.find((one) => one.deviceId === deviceId)
  const poor = quality !== null && (quality.packetLoss > 0.08 || quality.roundTripMs > 400)

  /*
   * The same ring as on the map, so "who is talking" looks like one thing
   * wherever it appears — and the same rule about motion, which is that the ring
   * carries the information and the pulse is what goes when somebody has asked
   * for less of it.
   */
  const reducedMotion = useReducedMotion()
  const speaking = device?.speaking ?? false

  return (
    <div
      className={[
        'relative shrink-0 overflow-hidden rounded-lg bg-base-300 ring-1 ring-base-300',
        placement === 'grid'
          ? 'aspect-video w-72 max-w-full'
          : placement === 'right'
            ? 'aspect-video w-full'
            : 'aspect-video h-24',
        speaking ? 'ring-2 ring-primary' : '',
      ].join(' ')}
      data-testid={`tile-${deviceId}`}
    >
      {/*
        The pulse is drawn as an overlay rather than on the tile itself: an
        animation on the container fades the video underneath it, which looks like
        a failing connection rather than like somebody talking.
      */}
      {speaking && !reducedMotion && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 animate-pulse rounded-lg ring-2 ring-primary ring-inset"
        />
      )}

      {stream ? (
        <video
          ref={video}
          autoPlay
          playsInline
          // Always muted: this element is a picture. The sound is the audio sink's
          // job, and an unmuted tile would play everybody twice.
          muted
          // Your own camera is mirrored, because that is how people expect to see
          // themselves. Everybody else is not.
          className={['h-full w-full object-cover', you ? 'scale-x-[-1]' : ''].join(' ')}
        />
      ) : (
        // Camera off is not a broken tile: it is somebody who has not turned it
        // on, and their name is what you actually need.
        <div className="grid h-full w-full place-items-center px-2 text-center text-xs text-base-content/70">
          {person?.displayName ?? 'Connecting…'}
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-base-100/85 px-1 py-0.5 text-[10px] backdrop-blur-sm">
        {person && <StatusDot status={person.status} size={8} labelled={false} />}
        <span className="min-w-0 flex-1 truncate">
          {you ? 'You' : (person?.displayName ?? 'Someone')}
          {/*
            A ring is invisible to a screen reader, so the tile says it too. Read
            straight after the name, which is the order somebody wants it in:
            who, then what they are doing.
          */}
          {speaking && <span className="sr-only">, speaking</span>}
        </span>

        {device?.muted && (
          <span className="text-error">
            <Icon name="mic-off" size="xs" title="Microphone off" />
          </span>
        )}

        {poor && (
          <span className="text-warning">
            <Icon
              name="alert"
              size="xs"
              title={quality?.relayed ? 'Relayed, weak connection' : 'Weak connection'}
            />
          </span>
        )}

        {/*
          Muting somebody for yourself needs no permission and tells nobody. It is
          the answer to background noise in a call with no host, and it has to be
          reversible in one click.
        */}
        {!you && (
          <button
            type="button"
            onClick={() => onMuteForMe(deviceId, !mutedForMe)}
            aria-pressed={mutedForMe}
            aria-label={
              mutedForMe
                ? `Unmute ${person?.displayName ?? 'this person'} for yourself`
                : `Mute ${person?.displayName ?? 'this person'} for yourself only`
            }
            className={[
              'rounded px-1 focus-visible:outline-2 focus-visible:outline-primary',
              mutedForMe ? 'bg-error text-error-content' : 'hover:bg-base-300',
            ].join(' ')}
          >
            <Icon name={mutedForMe ? 'mic-off' : 'mic'} size="xs" />
          </button>
        )}
      </div>

      {mutedForMe && (
        <span className="absolute left-1 top-1 rounded bg-error px-1 text-[9px] text-error-content">
          Muted for you
        </span>
      )}
    </div>
  )
}
