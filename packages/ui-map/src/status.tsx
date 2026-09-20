import type { Status } from '@unityevolv/ofiskit-realtime-client'

/**
 * One visual language for status, used on the map, in the list, on the room bar,
 * on a video tile and next to a name.
 *
 * The rule that shapes this file: **nothing is conveyed by colour alone.** Every
 * status is a different shape as well as a different colour, so it survives
 * being looked at by somebody who cannot tell green from amber, and it survives
 * being printed, screenshotted or rendered on a projector that eats saturation.
 *
 * Colours are token classes rather than values, so both themes come from the
 * kit and this file never knows either exists.
 */

export interface StatusLook {
  /** What a screen reader says, and what a tooltip shows. */
  label: string
  /** A token-backed text colour class; the shape inherits it. */
  tone: string
  /** Drawn inside a 12x12 viewBox, in `currentColor`. */
  shape: React.ReactNode
}

const RING = <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.75" />

export const STATUS_LOOKS: Record<Status, StatusLook> = {
  available: {
    label: 'Available',
    tone: 'text-success',
    // Solid: the most "present" shape there is.
    shape: <circle cx="6" cy="6" r="5" fill="currentColor" />,
  },
  in_call: {
    label: 'In a call',
    tone: 'text-primary',
    // A ring around a core, which reads as something happening inside.
    shape: (
      <>
        <circle cx="6" cy="6" r="5" fill="currentColor" />
        <circle cx="6" cy="6" r="1.75" fill="var(--color-base-100, #fff)" />
      </>
    ),
  },
  in_meeting: {
    label: 'In a meeting',
    tone: 'text-primary',
    // Square, because the meeting is elsewhere and this is deliberately not
    // the same thing as being in a call here.
    shape: <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" fill="currentColor" />,
  },
  away: {
    label: 'Away',
    tone: 'text-warning',
    // A clock, which is what away actually means: it has been a while.
    shape: (
      <>
        {RING}
        <path
          d="M6 3.5V6l1.75 1.25"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </>
    ),
  },
  dnd: {
    label: 'Do not disturb',
    tone: 'text-error',
    shape: (
      <>
        <circle cx="6" cy="6" r="5" fill="currentColor" />
        <rect
          x="2.75"
          y="5.1"
          width="6.5"
          height="1.8"
          rx="0.9"
          fill="var(--color-base-100, #fff)"
        />
      </>
    ),
  },
  reconnecting: {
    label: 'Reconnecting',
    tone: 'text-warning',
    // Broken ring: present, but not all there.
    shape: (
      <circle
        cx="6"
        cy="6"
        r="4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeDasharray="2.2 2"
        strokeLinecap="round"
      />
    ),
  },
  offline: {
    label: 'Offline',
    tone: 'text-base-content/40',
    shape: RING,
  },
}

export interface StatusDotProps {
  status: Status
  size?: number
  /**
   * Whether to name the status for assistive technology.
   *
   * Off where the surrounding text already says it, which is most places in a
   * list; on where the dot is the only thing carrying the meaning.
   */
  labelled?: boolean
  className?: string
}

export function StatusDot({ status, size = 12, labelled = true, className }: StatusDotProps) {
  const look = STATUS_LOOKS[status]
  return (
    <svg
      viewBox="0 0 12 12"
      width={size}
      height={size}
      className={[look.tone, 'shrink-0', className].filter(Boolean).join(' ')}
      role={labelled ? 'img' : 'presentation'}
      aria-label={labelled ? look.label : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
    >
      {look.shape}
    </svg>
  )
}

export function statusLabel(status: Status): string {
  return STATUS_LOOKS[status].label
}

/**
 * Status and custom status as one sentence.
 *
 * What a screen reader hears next to a name, and what a tooltip shows. Built in
 * one place so the map, the list and a tile never word it differently.
 */
export function describeStatus(status: Status, custom?: { text: string; emoji?: string }): string {
  const base = statusLabel(status)
  if (!custom?.text) return base
  return `${base} — ${custom.emoji ? `${custom.emoji} ` : ''}${custom.text}`
}
