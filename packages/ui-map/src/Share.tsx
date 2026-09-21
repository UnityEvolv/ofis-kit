import { Button, Icon, Modal } from '@unityevolv/unitykit'
import type { ScreenSource } from '@unityevolv/ofiskit-realtime-client'
import { usableSources } from '@unityevolv/ofiskit-realtime-client'
import { useEffect, useRef } from 'react'

/**
 * Showing a screen to the people in the call.
 *
 * Four pieces, separate because they appear in different places: the share itself
 * fills the call view, the indicator follows the sharer everywhere including back
 * onto the map, and the two questions are asked once and then gone.
 *
 * Provider-independent, like the tiles: a share here is a stream and a name, and
 * nothing in this file knows whether a mesh or somebody's SFU delivered it.
 */

export interface ShareStageProps {
  /** Whose screen it is. Used in the caption and in the accessible name. */
  sharerName: string
  /** True when it is your own screen, which is drawn completely differently. */
  mine: boolean
  /** The share, once it arrives. Absent is a loading state and not an error. */
  stream?: MediaStream | null
  /** The chosen speaker, so a shared tab's sound goes where the voices go. */
  speakerDeviceId?: string
  /** Offered only on your own share, and never more than one click away. */
  onStop?(): void
}

export function ShareStage({ sharerName, mine, stream, speakerDeviceId, onStop }: ShareStageProps) {
  const video = useRef<HTMLVideoElement>(null)

  // Assigned imperatively: a MediaStream is not a URL and React has no prop for it.
  useEffect(() => {
    if (video.current) video.current.srcObject = stream ?? null
  }, [stream])

  /*
   * Where a shared tab's sound comes out.
   *
   * The same routing the voices get, because it is part of the same conversation: a
   * share whose sound stays on the laptop speakers while everybody is listening
   * through a headset is both confusing and a source of echo. `setSinkId` is missing
   * on Safari and on mobile, where the operating system decides — which is the right
   * answer on a phone — so a failure here is silently the system default.
   */
  useEffect(() => {
    const element = video.current
    if (!element || !speakerDeviceId) return
    if (typeof element.setSinkId !== 'function') return
    void element.setSinkId(speakerDeviceId).catch(() => {})
  }, [speakerDeviceId, stream])

  /*
   * Your own share is not played back to you.
   *
   * Drawing a capture of this screen on this screen is the hall of mirrors everybody
   * has seen in a call at least once, and it tells the person nothing they do not
   * already know. What they need is what is here instead: confirmation that it is
   * going out, and a way to stop it.
   */
  if (mine) {
    return (
      <div
        data-testid="share-stage"
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-base-200 p-6 text-center"
      >
        <span className="text-primary">
          <Icon name="share" size="lg" />
        </span>
        <p className="text-sm font-medium">You are sharing your screen.</p>
        <p className="max-w-sm text-xs text-base-content/70">
          Everybody in the call can see it. Your own screen is not shown back to you,
          because that would be a picture of a picture.
        </p>
        {onStop && (
          <Button size="sm" variant="secondary" onClick={onStop}>
            Stop sharing
          </Button>
        )}
      </div>
    )
  }

  return (
    <div
      data-testid="share-stage"
      className="relative flex min-h-0 flex-1 items-center justify-center bg-base-300"
    >
      {stream ? (
        <video
          ref={video}
          autoPlay
          playsInline
          /*
            Not muted, unlike every tile: a shared tab's sound travels inside the
            share's own stream, so this element is where it belongs — the thing making
            the noise is the thing on screen. A share with no audio in it plays
            silently, and nothing here has to know which kind it is.
          */
          aria-label={`${sharerName}: shared screen`}
          // Contained rather than cropped. A share is usually text, and text with its
          // edges cut off is a share nobody can read.
          className="h-full w-full object-contain"
        />
      ) : (
        // Not an error: the call has said somebody is sharing and the stream is on
        // its way. Saying whose it is makes the wait explicable.
        <p className="p-6 text-sm text-base-content/70">Waiting for {sharerName}&rsquo;s screen…</p>
      )}

      {/* Whose screen this is, on the picture rather than beside it. */}
      <span className="absolute left-2 top-2 rounded bg-base-100/85 px-2 py-0.5 text-xs backdrop-blur-sm">
        {sharerName}
      </span>
    </div>
  )
}

/**
 * The sharer's own reminder that they are still sharing.
 *
 * Persistent, not dismissible, and present in every view including the map, because
 * forgetting to stop is the commonest failure in any call product and the
 * consequence of it is somebody's inbox on a projector. The stop control is here as
 * well as in the bar so that it is one click from wherever the person has wandered.
 */
export function SharingBanner({ onStop }: { onStop(): void }) {
  return (
    <div
      data-testid="sharing-banner"
      className="flex items-center justify-center gap-2 border-t border-primary/30 bg-primary/10 px-3 py-1 text-xs"
    >
      <span className="text-primary">
        <Icon name="share" size="xs" />
      </span>
      {/*
        Drawn, not announced. The share starting is said once, by the live region
        that says it to everybody; a banner that announced itself would repeat that
        to the one person who already knows.
      */}
      <span>You are sharing your screen.</span>
      <Button size="sm" variant="ghost" onClick={onStop}>
        Stop sharing
      </Button>
    </div>
  )
}

/**
 * Taking over somebody else's share.
 *
 * Asked rather than refused, because the person who wants to show something next is
 * usually right that they do — and asked rather than done quietly, because a share
 * that disappears mid-sentence looks like a crash to whoever was presenting.
 */
export function TakeOverDialog({
  sharerName,
  onConfirm,
  onCancel,
}: {
  sharerName: string
  onConfirm(): void
  onCancel(): void
}) {
  return (
    <Modal
      open
      onOpenChange={(next) => {
        // Escape and the overlay both mean "no". A dialog whose only safe answer is
        // the one button on it is a dialog people press the wrong thing in.
        if (!next) onCancel()
      }}
      title="Take over sharing?"
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={onConfirm}>
            Take over
          </Button>
        </>
      }
    >
      <p className="text-sm">
        {sharerName} is sharing a screen. A call shows one screen at a time, so yours
        would replace theirs, and they would be told that it stopped.
      </p>
    </Modal>
  )
}

export interface ScreenSourcePickerProps {
  /** The host's list, exactly as it gave it. Filtered here, not by the caller. */
  sources: readonly ScreenSource[]
  onPick(sourceId: string): void
  onCancel(): void
}

/**
 * The picker for a platform whose browser has none.
 *
 * On the web this never appears: `getDisplayMedia` opens the browser's own picker,
 * which people already know and which is the only one that can offer a single tab.
 * A desktop app has no such dialog — the platform hands over a list of screens and
 * windows and expects the app to draw it — so this is that list.
 *
 * Our own window is never in it. Sharing the app that is doing the sharing produces
 * an infinite mirror, and it is dropped by `usableSources` rather than here, so the
 * rule belongs to the list rather than to this one drawing of it.
 */
export function ScreenSourcePicker({ sources, onPick, onCancel }: ScreenSourcePickerProps) {
  const offered = usableSources(sources)

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
      title="Choose what to share"
      footer={
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      }
    >
      {offered.length === 0 ? (
        // Empty rather than broken, and it says what to do about it.
        <p className="text-sm text-base-content/70">
          There is nothing available to share. Open the window you want to show, then
          try again.
        </p>
      ) : (
        <ul data-testid="screen-sources" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {offered.map((source) => (
            <li key={source.id}>
              <button
                type="button"
                onClick={() => onPick(source.id)}
                // Named with what it is as well as what it is called: two entries
                // both called "1" is exactly the confusion this avoids.
                aria-label={`Share ${source.kind}: ${source.name}`}
                className="w-full rounded-lg border border-base-300 p-1 text-left hover:border-primary focus-visible:outline-2 focus-visible:outline-primary"
              >
                {source.thumbnailUrl ? (
                  // A list of window titles is close to useless — half of them are
                  // the same word repeated — and the thumbnail is how somebody
                  // recognises the thing they meant. Empty alt: the button above is
                  // already named, and a second reading adds nothing.
                  <img
                    src={source.thumbnailUrl}
                    alt=""
                    className="aspect-video w-full rounded object-cover"
                  />
                ) : (
                  <span className="grid aspect-video w-full place-items-center rounded bg-base-200">
                    <Icon name="share" size="sm" />
                  </span>
                )}
                <span className="mt-1 block truncate text-xs">{source.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

    </Modal>
  )
}

/**
 * What a live region says about a share.
 *
 * Politely, and named. A share is a change to what is on everybody's screen, and
 * somebody who cannot see it change is precisely the person who needs telling.
 */
export function describeShare(sharerName: string, sharing: boolean): string {
  return sharing
    ? `${sharerName} is sharing their screen.`
    : `${sharerName} stopped sharing their screen.`
}
