import { Button, Icon } from '@unityevolv/unitykit'
import { useEffect } from 'react'

/**
 * Somebody is at the door, and what happens next.
 *
 * Two sides of the same moment. Inside the room, a knock with a name and two
 * buttons. Outside, feedback that the knock was sent and then a clear outcome —
 * because the worst version of this feature is knocking into silence and never
 * learning whether anybody saw it.
 *
 * Admitting lets that one person in without unlocking the room for anybody else,
 * and the card says so, because "let them in" reads like "open the door".
 */

export interface IncomingKnock {
  knockId: string
  roomId: string
  userId: string
  displayName: string
  photoUrl?: string
  /** True when everybody inside is on do not disturb: it arrived without a sound. */
  silent: boolean
}

export interface KnockDockProps {
  knocks: IncomingKnock[]
  onAdmit(knockId: string): void
  onDecline(knockId: string): void
}

export function KnockDock({ knocks, onAdmit, onDecline }: KnockDockProps) {
  if (knocks.length === 0) return null

  return (
    // A section rather than a div: an aria-label on a plain div is exposed to
    // nothing, so the label would have been decoration. As a landmark it is
    // something somebody can jump to while a colleague waits outside.
    <section
      className="pointer-events-auto absolute bottom-4 right-4 z-30 flex w-72 flex-col gap-2"
      aria-label="People knocking"
    >
      {knocks.map((knock) => (
        <div
          key={knock.knockId}
          className="rounded-lg bg-base-100 p-3 shadow-lg ring-1 ring-base-300"
          data-testid={`knock-${knock.knockId}`}
        >
          <p className="flex items-center gap-2 text-sm">
            <Icon name="knock" size="sm" />
            <span>
              <strong>{knock.displayName}</strong> would like to come in.
            </span>
          </p>

          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => onAdmit(knock.knockId)}>
              Let them in
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onDecline(knock.knockId)}>
              Not now
            </Button>
          </div>

          {/*
            Said on the card rather than left to be discovered, because "let them
            in" reads like unlocking the door and it is not that.
          */}
          <p className="mt-1.5 text-xs text-base-content/60">
            Letting them in does not unlock the room for anyone else.
          </p>
        </div>
      ))}
    </section>
  )
}

export type KnockOutcome = 'waiting' | 'admitted' | 'declined' | 'expired' | 'refused'

export interface OutgoingKnockProps {
  roomName: string
  outcome: KnockOutcome
  /** The reason, when the knock was refused outright — rate limited, say. */
  message?: string | null
  /** True when it arrived silently, so the knocker knows why it may go unanswered. */
  silent?: boolean
  onDismiss(): void
}

/**
 * What the person who knocked sees.
 *
 * Every outcome is said plainly, **including the one where nobody answered**,
 * because an unanswered knock is otherwise indistinguishable from a broken one.
 * A refusal says why: repeated knocking is rate limited, and a button that
 * appears to do nothing is worse than a button that says no.
 */
export function OutgoingKnock({
  roomName,
  outcome,
  message,
  silent = false,
  onDismiss,
}: OutgoingKnockProps) {
  // Anything final clears itself after a few seconds. Only "waiting" stays, for
  // as long as the waiting does.
  useEffect(() => {
    if (outcome === 'waiting') return
    const timer = setTimeout(onDismiss, 6000)
    return () => clearTimeout(timer)
  }, [outcome, onDismiss])

  const text: Record<KnockOutcome, string> = {
    waiting: silent
      ? `Knocked on ${roomName}. Everybody inside is on do not disturb, so it arrived silently.`
      : `Knocked on ${roomName}. Waiting for an answer…`,
    admitted: `You were let into ${roomName}.`,
    declined: `Not right now — try ${roomName} again in a bit.`,
    expired: `Nobody answered in ${roomName}.`,
    refused: message ?? 'That knock could not be sent.',
  }

  const tone =
    outcome === 'admitted'
      ? 'bg-success text-success-content'
      : outcome === 'waiting'
        ? 'bg-base-100 text-base-content ring-1 ring-base-300'
        : 'bg-base-300 text-base-content'

  return (
    <div
      role="status"
      // Named, because the announcer's polite live region is a `status` too, and a
      // test that cannot tell the two apart is a test of neither.
      data-testid="outgoing-knock"
      className={['pointer-events-auto rounded-lg px-3 py-2 text-sm shadow-lg', tone].join(' ')}
    >
      <div className="flex items-center gap-2">
        <Icon name={outcome === 'admitted' ? 'check' : 'knock'} size="sm" />
        <span>{text[outcome]}</span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="ml-auto rounded p-0.5 hover:bg-base-200/50 focus-visible:outline-2 focus-visible:outline-primary"
        >
          <Icon name="close" size="xs" />
        </button>
      </div>
    </div>
  )
}
