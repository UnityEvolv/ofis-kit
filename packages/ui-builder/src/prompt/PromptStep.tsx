import { Alert, Button, Icon, Input, Textarea } from '@unityevolv/unitykit'
import { CANVAS_SHAPES, type CanvasShape } from '@unityevolv/ofiskit-template'
import { useMemo, useState } from 'react'

import {
  applyPreset,
  defaultSlots,
  renderPrompt,
  type PromptDocument,
  type SlotValues,
} from './prompt.js'

/**
 * Step one, before a single room is drawn: the prompt for the picture.
 *
 * An author who opens a drawing tool with no background has nothing to draw on,
 * and "find a top-down floor plan" is not a task most people can do. So this
 * step hands them a prompt that already works, with the shape and resolution
 * filled in and the parts worth changing exposed as fields.
 *
 * The canvas shape is chosen here because it cannot change afterwards: every
 * room is placed relative to it. The step says so rather than letting somebody
 * find out after an hour of drawing.
 */

export interface PromptStepProps {
  document: PromptDocument
  shape: CanvasShape
  onShapeChange(shape: CanvasShape): void
  /** What choosing a different shape would undo, said before it happens. */
  shapeChangeWarning?: string
}

export function PromptStep(props: PromptStepProps) {
  const { document: prompt, shape } = props
  const [values, setValues] = useState<SlotValues>(() => defaultSlots(prompt))
  const [copied, setCopied] = useState(false)

  const text = useMemo(() => renderPrompt(prompt, shape, values), [prompt, shape, values])

  return (
    <div className="mx-auto grid max-w-5xl gap-6 p-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Choose the shape of your office</h2>
          <p className="mt-1 text-sm text-base-content/75">
            This cannot change once rooms are placed, because every room is positioned against it.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {CANVAS_SHAPES.map((candidate) => (
              <button
                key={candidate}
                type="button"
                onClick={() => props.onShapeChange(candidate)}
                aria-pressed={shape === candidate}
                className={[
                  'rounded-lg border px-3 py-2 text-sm',
                  'focus-visible:outline-2 focus-visible:outline-primary',
                  shape === candidate
                    ? 'border-primary bg-primary/10 font-medium'
                    : 'border-base-300 hover:bg-base-200',
                ].join(' ')}
              >
                {prompt.canvases[candidate].label}
                {/*
                  Full-strength ink, not a faded tint. The selected button has a
                  tinted background, and faded small text on top of it drops
                  under AA contrast — the size and weight already carry the
                  hierarchy without borrowing from the contrast to do it.
                */}
                <span className="block text-xs text-base-content">
                  {prompt.canvases[candidate].resolution}
                </span>
              </button>
            ))}
          </div>

          {props.shapeChangeWarning && (
            <Alert variant="warn" className="mt-3">
              {props.shapeChangeWarning}
            </Alert>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">The prompt</h2>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void navigator.clipboard.writeText(text).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                })
              }}
            >
              <Icon name={copied ? 'check' : 'copy'} size="sm" />
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>

          {/*
            Shown in full, and read-only. The rules at the bottom are what make
            a picture usable as an office: no text, nothing tall on desks, seats
            drawn. An author editing those gets a nicer picture and a worse
            office.
          */}
          <Textarea
            readOnly
            value={text}
            rows={16}
            className="mt-2 font-mono text-xs"
            aria-label="The prompt"
          />
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold">Start from a theme</h3>
          <p className="mt-1 text-xs text-base-content/70">
            Each one fills in every field below. A good place to start if you have no idea what you
            want.
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {Object.entries(prompt.presets).map(([id, preset]) => (
              <button
                key={id}
                type="button"
                onClick={() => setValues(applyPreset(preset))}
                className="rounded-full bg-base-200 px-2 py-1 text-xs hover:bg-base-300 focus-visible:outline-2 focus-visible:outline-primary"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {Object.entries(prompt.slots).map(([key, slot]) => (
            <Input
              key={key}
              label={slot.label}
              help={slot.help}
              value={values[key] ?? ''}
              onChange={(event) => setValues({ ...values, [key]: event.target.value })}
            />
          ))}
        </div>

        <div className="rounded-lg bg-base-200 p-3">
          <h3 className="text-sm font-semibold">Worth knowing</h3>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-base-content/75">
            {prompt.guidance.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
