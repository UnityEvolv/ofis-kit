import { Button, Popover, Toggle } from '@unityevolv/unitykit'
import { useId } from 'react'

import type { Ambience } from './useAmbience.js'

/**
 * The room's ambience, said and controlled from the bar.
 *
 * Three jobs in one small control:
 * - it says a loop belongs to this room — shown even to somebody who has
 *   ambience off, so they know what the people beside them can hear;
 * - when the browser wants a press before it will play anything, it is that
 *   press, rather than the app trying to get round the rule;
 * - it holds the person's switch and volume, which the host stores where it
 *   stores them (a profile in unityofis, this browser in the free app).
 *
 * Words rather than a speaker icon, and the state in words too, so nothing is
 * told by colour or by a glyph alone. Nothing here moves, so there is nothing
 * for reduced motion to stop.
 */

export interface AmbienceLabels {
  /** "Café ambience" — the loop's name in a sentence. */
  name(label: string): string
  start(label: string): string
  /** The offer said to a screen reader when the browser is waiting for a press. */
  offer(label: string): string
  playing: string
  off: string
  paused: string
  loading: string
  unavailable: string
  blocked: string
  settings(label: string, state: string): string
  enabled: string
  enabledHelp: string
  volume: string
}

export const AMBIENCE_LABELS: AmbienceLabels = {
  name: (label) => `${label} ambience`,
  start: (label) => `Play ${label} ambience`,
  offer: (label) => `This room has ${label} ambience. Press Play to hear it.`,
  playing: 'Playing',
  off: 'Off for you',
  paused: 'Paused for the call',
  loading: 'Loading',
  unavailable: 'Unavailable',
  blocked: 'Waiting to start',
  settings: (label, state) => `${label} ambience: ${state}. Ambience settings`,
  enabled: 'Play room ambience',
  enabledHelp: 'Off means off: no room or office starts it again.',
  volume: 'Ambience volume',
}

export interface AmbienceControlProps {
  ambience: Pick<Ambience, 'status' | 'track' | 'start'>
  /** The person's switch. */
  enabled: boolean
  /** 0..1 */
  volume: number
  onEnabledChange(enabled: boolean): void
  onVolumeChange(volume: number): void
  /** The host's translations. English when absent. */
  labels?: Partial<AmbienceLabels>
}

const STATE_KEYS = {
  playing: 'playing',
  off: 'off',
  paused: 'paused',
  loading: 'loading',
  unavailable: 'unavailable',
  blocked: 'blocked',
} as const

export function AmbienceControl({
  ambience,
  enabled,
  volume,
  onEnabledChange,
  onVolumeChange,
  labels,
}: AmbienceControlProps) {
  const words = { ...AMBIENCE_LABELS, ...labels }
  const volumeId = useId()
  const { status, track } = ambience

  if (status === 'silent' || track === null) return null

  if (status === 'blocked') {
    return (
      <>
        <Button size="sm" variant="ghost" onClick={ambience.start}>
          {words.start(track.label)}
        </Button>
        {/* Polite, once, as it appears: the button is the offer, and this says it
            to somebody who is not looking at the bar. */}
        <span role="status" className="sr-only">
          {words.offer(track.label)}
        </span>
      </>
    )
  }

  const state = words[STATE_KEYS[status]]
  const percent = Math.round(Math.min(1, Math.max(0, volume)) * 100)

  return (
    <Popover
      side="top"
      align="end"
      width="sm"
      trigger={
        <button
          type="button"
          aria-label={words.settings(track.label, state)}
          className="inline-flex h-9 max-w-48 items-center gap-1 truncate rounded-lg px-2 text-sm hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
        >
          <span className="truncate font-medium">{track.label}</span>
          <span className="text-base-content/70 max-sm:sr-only">· {state}</span>
        </button>
      }
    >
      <div className="space-y-3">
        <p className="text-sm font-medium">{words.name(track.label)}</p>
        <Toggle
          label={words.enabled}
          help={words.enabledHelp}
          checked={enabled}
          onChange={(event) => onEnabledChange(event.target.checked)}
        />
        <div className="space-y-1">
          <label htmlFor={volumeId} className="text-sm">
            {words.volume}
          </label>
          <input
            id={volumeId}
            type="range"
            min={0}
            max={100}
            step={5}
            value={percent}
            disabled={!enabled}
            aria-valuetext={`${percent}%`}
            onChange={(event) => onVolumeChange(Number(event.target.value) / 100)}
            className="range range-primary range-xs w-full"
          />
        </div>
      </div>
    </Popover>
  )
}
