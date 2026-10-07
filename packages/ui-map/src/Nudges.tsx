import { Button, Icon, Modal, Textarea } from '@unityevolv/unitykit'
import { NUDGE_LINE_MAX } from '@unityevolv/ofiskit-realtime-client'
import { useEffect, useId, useRef, useState } from 'react'

import type { HostAction } from './HostActions.js'
import type { IncomingNudge } from './useNudges.js'

/**
 * A tap on the shoulder, both ends of it.
 *
 * Receiving: a notice saying who, where they are, and their line, with the two
 * things somebody does next — go to them, or not now — and whatever the host
 * adds, such as inviting them here. Sending: one optional line, capped at a
 * tweet's length, because a nudge that becomes a message defeats itself.
 */

/** How long a nudge stays on screen before it goes by itself. */
export const NUDGE_VISIBLE_MS = 60_000

export interface NudgeDockProps {
  nudges: readonly IncomingNudge[]
  /** The room's name for "in Library". */
  roomName(roomId: string): string
  /** The room you are in, so "join them" is disabled, with a reason, when you are there already. */
  yourRoomId: string | null
  onJoin(nudge: IncomingNudge): void
  onDismiss(nudgeId: string): void
  /** The host's own actions on a nudge, such as inviting them to your room. */
  actions?(nudge: IncomingNudge): readonly HostAction[]
  /** How long one stays before it goes by itself. */
  visibleMs?: number
}

export function NudgeDock({
  nudges,
  roomName,
  yourRoomId,
  onJoin,
  onDismiss,
  actions,
  visibleMs = NUDGE_VISIBLE_MS,
}: NudgeDockProps) {
  if (nudges.length === 0) return null
  return (
    // A landmark, like the knocks: somebody can jump to it while a colleague waits.
    <section
      className="pointer-events-auto flex w-72 flex-col gap-2"
      aria-label="Nudges"
      data-testid="nudge-dock"
    >
      {nudges.map((nudge) => (
        <NudgeCard
          key={nudge.nudgeId}
          nudge={nudge}
          where={roomName(nudge.roomId)}
          together={nudge.roomId === yourRoomId}
          onJoin={() => onJoin(nudge)}
          onDismiss={() => onDismiss(nudge.nudgeId)}
          actions={actions?.(nudge) ?? []}
          visibleMs={visibleMs}
        />
      ))}
    </section>
  )
}

function NudgeCard(props: {
  nudge: IncomingNudge
  where: string
  together: boolean
  onJoin(): void
  onDismiss(): void
  actions: readonly HostAction[]
  visibleMs: number
}) {
  const { nudge, where, together, onJoin, onDismiss, actions, visibleMs } = props
  const hintId = useId()

  /*
   * Goes by itself after a while: a nudge is about now, and an old one is noise.
   *
   * The callback is read through a ref so the timer starts once, when the card
   * appears, rather than again every time the dock above it re-renders.
   */
  const dismissLater = useRef(onDismiss)
  useEffect(() => {
    dismissLater.current = onDismiss
  }, [onDismiss])
  useEffect(() => {
    const timer = setTimeout(() => dismissLater.current(), visibleMs)
    return () => clearTimeout(timer)
  }, [visibleMs])

  return (
    <div
      className="rounded-lg bg-base-100 p-3 shadow-lg ring-1 ring-base-300"
      data-testid={`nudge-${nudge.nudgeId}`}
    >
      <p className="flex items-center gap-2 text-sm">
        <Icon name="bell" size="sm" />
        <span>
          <strong>{nudge.displayName}</strong> nudged you from {where}.
        </span>
      </p>
      {nudge.line && (
        // Drawn as text and nothing else: no formatting, no links, no mentions.
        <p className="mt-1 break-words text-sm text-base-content/80">“{nudge.line}”</p>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={onJoin}
          disabled={together}
          {...(together ? { 'aria-describedby': hintId } : {})}
        >
          Join them
        </Button>
        {actions.map((action) => (
          <Button
            key={action.id}
            size="sm"
            variant="secondary"
            disabled={Boolean(action.disabled)}
            title={action.disabled ?? undefined}
            onClick={() => {
              action.onSelect()
              onDismiss()
            }}
          >
            {action.label}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
      {together && (
        <p id={hintId} className="mt-1 text-xs text-base-content/70">
          You are already in the same room.
        </p>
      )}
    </div>
  )
}

export interface HeldNudgesProps {
  /** Nudges waiting for your call to end. Nothing is drawn for none. */
  count: number
}

/**
 * The quiet badge: nudges waiting until your call ends.
 *
 * A count and nothing else, because a name and a line would be the interruption
 * that holding them exists to avoid. They are shown as ordinary notices once the
 * call is over.
 */
export function HeldNudges({ count }: HeldNudgesProps) {
  if (count === 0) return null
  const text = count === 1 ? '1 nudge after your call' : `${count} nudges after your call`
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-base-200 px-2 py-0.5 text-xs text-base-content"
      data-testid="held-nudges"
      title={text}
    >
      <Icon name="bell" size="xs" />
      <span aria-hidden="true">{count}</span>
      <span className="sr-only">{text}</span>
    </span>
  )
}

export interface NudgeDialogProps {
  open: boolean
  /** Who is being nudged, for the title. */
  name: string
  onSend(line: string | undefined): void
  onClose(): void
}

/**
 * Nudge, with one optional line.
 *
 * Plain text, folded to one line, and counted down to the same number the server
 * refuses past. Sending with nothing typed is the ordinary case: "got a minute?"
 * is what a nudge means without saying it.
 */
export function NudgeDialog({ open, name, onSend, onClose }: NudgeDialogProps) {
  const [line, setLine] = useState('')
  const left = NUDGE_LINE_MAX - [...line].length

  const close = () => {
    setLine('')
    onClose()
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => (next ? undefined : close())}
      title={`Nudge ${name}`}
      description="They see who it was and can come over. Nothing is kept afterwards."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={left < 0}
            onClick={() => {
              const folded = line.replace(/\s+/g, ' ').trim()
              onSend(folded.length > 0 ? folded : undefined)
              setLine('')
            }}
          >
            Nudge
          </Button>
        </>
      }
    >
      <Textarea
        label="A line, if you like"
        help={left >= 0 ? `${left} characters left` : `${-left} over the limit`}
        value={line}
        rows={2}
        onChange={(event) => setLine(event.target.value)}
        {...(left < 0 ? { error: 'A nudge is one short line.' } : {})}
      />
    </Modal>
  )
}
