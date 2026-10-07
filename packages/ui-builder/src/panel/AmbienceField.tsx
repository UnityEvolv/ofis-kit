import { Button, Select } from '@unityevolv/unitykit'
import { AMBIENCE_NONE, type AmbienceTrack } from '@unityevolv/ofiskit-template'
import { useEffect, useRef, useState } from 'react'

/**
 * Choosing a room's or the office's background loop, with a preview.
 *
 * The preview is so the author hears a loop before publishing it to everyone.
 * It plays here, in the builder, at a modest volume, and stops when the choice
 * changes, when the author moves on, or when they press it again. A plain audio
 * element is enough for that: the seamless looping the office needs is the
 * player's job, not a ten-second listen's.
 */

/** How loud the preview plays. The author hears it, the room behind them does not. */
export const PREVIEW_VOLUME = 0.4

/** The select's value for "follow the office default". Never a library id: ids are slugs. */
const INHERIT = ''

export interface AmbienceFieldProps {
  label: string
  help?: string
  /** The stored value: an id, `"none"`, or undefined. */
  value: string | undefined
  library: readonly AmbienceTrack[]
  /**
   * Set for a room: what following the office means here, said in the option,
   * so "Same as the office" is never a mystery. Absent for the office itself,
   * whose only alternative to a loop is silence.
   */
  inherited?: { label: string | null }
  onChange(value: string | undefined): void
}

export function AmbienceField({
  label,
  help,
  value,
  library,
  inherited,
  onChange,
}: AmbienceFieldProps) {
  const [previewing, setPreviewing] = useState(false)
  const audio = useRef<HTMLAudioElement | null>(null)

  const stop = () => {
    audio.current?.pause()
    audio.current = null
    setPreviewing(false)
  }

  // A preview never outlives the panel it was started from.
  useEffect(
    () => () => {
      audio.current?.pause()
      audio.current = null
    },
    [],
  )

  const selected = value === undefined ? (inherited ? INHERIT : AMBIENCE_NONE) : value
  const track = library.find((one) => one.id === selected) ?? null
  const unknown = value !== undefined && value !== AMBIENCE_NONE && track === null

  const preview = () => {
    if (previewing || !track) {
      stop()
      return
    }
    const element = new Audio(track.src)
    element.loop = true
    element.volume = PREVIEW_VOLUME
    audio.current = element
    setPreviewing(true)
    // A browser may still refuse; the author pressed a button, so that is rare,
    // and a silent preview is not worth an error.
    void element.play().catch(() => setPreviewing(false))
  }

  return (
    <div className="space-y-1">
      <Select
        label={label}
        {...(help ? { help } : {})}
        value={selected}
        onChange={(event) => {
          stop()
          const next = event.target.value
          onChange(next === INHERIT || (!inherited && next === AMBIENCE_NONE) ? undefined : next)
        }}
      >
        {inherited && (
          <option value={INHERIT}>
            {inherited.label
              ? `Same as the office (${inherited.label})`
              : 'Same as the office (none)'}
          </option>
        )}
        <option value={AMBIENCE_NONE}>None</option>
        {library.map((one) => (
          <option key={one.id} value={one.id}>
            {one.label}
          </option>
        ))}
        {/* A template from somewhere with a bigger library keeps its choice
            rather than having it silently replaced. */}
        {unknown && <option value={value}>{`${value} (not in this library)`}</option>}
      </Select>

      {track && (
        // The label says what pressing does, like every control in the office.
        <Button size="sm" variant="ghost" onClick={preview}>
          {previewing ? `Stop preview of ${track.label}` : `Preview ${track.label}`}
        </Button>
      )}
    </div>
  )
}
