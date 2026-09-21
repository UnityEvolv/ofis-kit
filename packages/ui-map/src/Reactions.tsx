import type { Reaction } from '@unityevolv/ofiskit-realtime-client'
import { REACTIONS } from '@unityevolv/ofiskit-realtime-client'

import { useReducedMotion } from './hooks.js'
import type { LiveReaction } from './useCall.js'

/**
 * Reacting without interrupting, and seeing that somebody did.
 *
 * Two pieces that belong together: the picker somebody sends from, and the float
 * that appears over whoever sent it. Both are here so the set of reactions is read
 * from one place and drawn the same way over a tile and over an avatar.
 *
 * **Nothing is stored.** A reaction floats for a few seconds and then it has
 * stopped existing — not archived, not in the office state, not on the server.
 * Somebody who was not looking missed it, which is what happens with a nod.
 */

export interface ReactionFloatProps {
  /** What is in the air over this person right now. Empty draws nothing at all. */
  reactions: readonly LiveReaction[]
  /** Roughly how big to draw them, in pixels. A tile wants more than an avatar. */
  size?: number
}

/**
 * The reactions in the air over one person.
 *
 * Absolutely positioned and `pointer-events-none`, so it can never take a click
 * meant for the tile or the avatar underneath it — a reaction that swallows the
 * mute button is worse than no reaction.
 *
 * Announced politely rather than drawn only. It is deliberately **not** assertive:
 * applause must not interrupt a screen reader mid-sentence, which is the whole
 * point of reacting this way rather than saying something.
 */
export function ReactionFloat({ reactions, size = 22 }: ReactionFloatProps) {
  const reducedMotion = useReducedMotion()
  if (reactions.length === 0) return null

  return (
    <span
      className="pointer-events-none absolute inset-x-0 bottom-1/3 z-20 flex items-end justify-center gap-0.5"
      data-testid="reaction-float"
    >
      {reactions.map((one) => (
        <span
          key={one.id}
          // A bob rather than a static badge, because a reaction that appears with
          // no movement reads as a badge somebody earned rather than as a thing
          // that just happened. Still, and still visible, under reduced motion.
          className={['leading-none drop-shadow', reducedMotion ? '' : 'animate-bounce'].join(' ')}
          style={{ fontSize: size }}
        >
          {/*
            The emoji itself carries the meaning to a screen reader, via the live
            region below rather than by labelling each one — the live region is
            what makes a reaction reach somebody who is not looking at the tile.
          */}
          <span aria-hidden="true">{one.reaction}</span>
        </span>
      ))}
    </span>
  )
}

export interface ReactionPickerProps {
  onReact(reaction: Reaction): void
  disabled?: boolean
}

/**
 * The six, in a row.
 *
 * A row rather than a menu behind a menu: this is pressed in the middle of
 * somebody else's sentence, and anything that takes two decisions will not be
 * used. Every one is a real button with a real name, because an emoji on its own
 * is not a label — "thumbs up" is.
 */
export function ReactionPicker({ onReact, disabled = false }: ReactionPickerProps) {
  return (
    <div
      role="group"
      aria-label="React"
      data-testid="reaction-picker"
      className="flex items-center gap-0.5"
    >
      {REACTIONS.map((reaction) => (
        <button
          key={reaction}
          type="button"
          disabled={disabled}
          onClick={() => onReact(reaction)}
          aria-label={`React with ${NAMES[reaction]}`}
          className={[
            'inline-flex h-8 w-8 items-center justify-center rounded-lg text-lg leading-none',
            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
            disabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-base-200',
          ].join(' ')}
        >
          <span aria-hidden="true">{reaction}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * What each one is called.
 *
 * Here rather than in the protocol, because a name is for a person to read and the
 * protocol carries what both sides must agree on. The keys are exhaustive against
 * the set, so adding a reaction without naming it is a compile error rather than a
 * button announced as "react with".
 */
const NAMES: Record<Reaction, string> = {
  '👍': 'thumbs up',
  '👏': 'applause',
  '🎉': 'celebration',
  '😂': 'laughing',
  '❤️': 'love',
  '😮': 'surprise',
}

/** The words a live region says when somebody reacts. Used by the host's announcer. */
export function describeReaction(displayName: string, reaction: string): string {
  const name = NAMES[reaction as Reaction]
  return name ? `${displayName} reacted: ${name}.` : `${displayName} reacted.`
}
