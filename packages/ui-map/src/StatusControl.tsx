import { Button, Icon, Input, Popover, Select } from '@unityevolv/unitykit'
import type {
  CustomStatus,
  ManualStatus,
  PublicPresence,
} from '@unityevolv/ofiskit-realtime-client'
import { useState } from 'react'

import { StatusDot, statusLabel } from './status.js'

/**
 * Where a person sets and sees their own status.
 *
 * Two things are going on at once and the control has to keep them apart: what
 * the product worked out (idle, in a call, in the break room) and what the
 * person chose. A chosen status always wins and survives everything automatic,
 * so the control says which one is in force and offers a clear way back.
 */

/** The fixed-length choices. Everything else is worked out in the viewer's zone. */
const DURATIONS = [
  { id: '30m', label: '30 minutes', ms: 30 * 60 * 1000 },
  { id: '1h', label: '1 hour', ms: 60 * 60 * 1000 },
  { id: '4h', label: '4 hours', ms: 4 * 60 * 60 * 1000 },
  { id: 'today', label: 'Today', ms: null },
  { id: 'never', label: 'Until I clear it', ms: null },
] as const

export interface StatusControlProps {
  you: PublicPresence | null
  /** True when the person chose this status, rather than the office working it out. */
  chosen: boolean
  /** True when do not disturb came from standing in the break room. */
  fromBreakRoom: boolean
  /** Presets an org defined. The free office has none, and shows none. */
  presets?: readonly CustomStatus[]
  onSetStatus(manual: ManualStatus | null): void
  onSetCustom(custom: CustomStatus | null): void
}

const CHOICES: Array<{ value: ManualStatus; label: string }> = [
  { value: 'available', label: 'Available' },
  { value: 'away', label: 'Away' },
  { value: 'dnd', label: 'Do not disturb' },
]

/**
 * When a duration expires, in the viewer's zone.
 *
 * "Today" means the end of today where the person is, so the client works it
 * out and sends an absolute instant. The server never computes a date in
 * anybody's time zone, and it should not have to know where anyone is.
 */
function expiryFor(id: string): string | undefined {
  const choice = DURATIONS.find((duration) => duration.id === id)
  if (!choice || choice.id === 'never') return undefined

  if (choice.ms !== null) return new Date(Date.now() + choice.ms).toISOString()

  const endOfDay = new Date()
  endOfDay.setHours(23, 59, 59, 999)
  return endOfDay.toISOString()
}

/** Formats an expiry for the person looking at it, in their own zone. */
function formatExpiry(iso: string): string {
  const when = new Date(iso)
  const today = new Date()
  const sameDay = when.toDateString() === today.toDateString()

  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    ...(sameDay ? {} : { weekday: 'short' }),
  }).format(when)
}

export function StatusControl(props: StatusControlProps) {
  const { you, chosen, fromBreakRoom, presets = [] } = props
  const [text, setText] = useState('')
  const [emoji, setEmoji] = useState('')
  const [duration, setDuration] = useState<string>('1h')

  const status = you?.status ?? 'offline'

  return (
    <Popover
      width="auto"
      trigger={
        <button
          type="button"
          className="inline-flex max-w-52 items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
          aria-label={`Your status: ${statusLabel(status)}${you?.custom ? `, ${you.custom.text}` : ''}. Change it.`}
        >
          <StatusDot status={status} size={12} labelled={false} />
          <span className="truncate">
            {you?.custom
              ? `${you.custom.emoji ?? ''} ${you.custom.text}`.trim()
              : statusLabel(status)}
          </span>
          <Icon name="chevron-down" size="xs" />
        </button>
      }
    >
      <div className="w-72 space-y-3">
        <div>
          <p className="mb-1 text-xs font-medium text-base-content/70">Your status</p>
          <div className="flex flex-col gap-0.5">
            {CHOICES.map((choice) => (
              <button
                key={choice.value}
                type="button"
                onClick={() => props.onSetStatus(choice.value)}
                aria-pressed={chosen && status === choice.value}
                className={[
                  'flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm',
                  'hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary',
                  chosen && status === choice.value ? 'bg-base-200 font-medium' : '',
                ].join(' ')}
              >
                <StatusDot status={choice.value} size={12} labelled={false} />
                {choice.label}
              </button>
            ))}
          </div>

          {chosen && (
            <button
              type="button"
              onClick={() => props.onSetStatus(null)}
              className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-primary hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
            >
              Go back to working it out automatically
            </button>
          )}

          {/*
              Automatic changes surface quietly rather than as a notification.
              Being told "you went away" is the kind of interruption this
              product exists to avoid.
            */}
          {!chosen && fromBreakRoom && (
            <p className="mt-1 px-2 text-xs text-base-content/70">
              Do not disturb, because you are in the break room. Knocks still arrive, silently.
            </p>
          )}
        </div>

        <div className="border-t border-base-300 pt-3">
          <p className="mb-1 text-xs font-medium text-base-content/70">Custom status</p>

          {presets.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {presets.map((preset) => (
                <button
                  key={preset.text}
                  type="button"
                  onClick={() => props.onSetCustom(preset)}
                  className="rounded-full bg-base-200 px-2 py-0.5 text-xs hover:bg-base-300 focus-visible:outline-2 focus-visible:outline-primary"
                >
                  {preset.emoji} {preset.text}
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-1">
            <Input
              aria-label="Emoji"
              value={emoji}
              onChange={(event) => setEmoji(event.target.value.slice(0, 4))}
              placeholder="🥪"
              className="w-14 text-center"
            />
            <Input
              aria-label="What is your status?"
              value={text}
              onChange={(event) => setText(event.target.value.slice(0, 100))}
              placeholder="Lunch, back at two"
              className="flex-1"
            />
          </div>

          <Select
            label="Clear it"
            className="mt-2"
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
          >
            {DURATIONS.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </Select>

          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              disabled={text.trim().length === 0}
              onClick={() => {
                const expiresAt = expiryFor(duration)
                props.onSetCustom({
                  text: text.trim(),
                  ...(emoji ? { emoji } : {}),
                  ...(expiresAt ? { expiresAt } : {}),
                })
                setText('')
                setEmoji('')
              }}
            >
              Set status
            </Button>

            {you?.custom && (
              <Button size="sm" variant="ghost" onClick={() => props.onSetCustom(null)}>
                Clear
              </Button>
            )}
          </div>

          {/*
              Showing the expiry beside it means nobody is surprised when it
              disappears, which is the only complaint this feature ever gets.
            */}
          {you?.custom?.expiresAt && (
            <p className="mt-1 text-xs text-base-content/70">
              Clears at {formatExpiry(you.custom.expiresAt)}.
            </p>
          )}
        </div>
      </div>
    </Popover>
  )
}
