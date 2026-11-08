import { Accordion, Alert, Button, Icon, Input, Tabs, Textarea } from '@unityevolv/unitykit'
import { CANVAS_SHAPES, type CanvasShape } from '@unityevolv/ofiskit-template'
import { useMemo, useState } from 'react'

import {
  applyPreset,
  defaultSlots,
  renderPrompt,
  type OfficePrompt,
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
 *
 * The step fits one screen. There are two ways to a picture, a painting the
 * rooms are drawn onto or an SVG that carries them, and each is a tab, so
 * neither sits under the other; the fields that tune the picture prompt and
 * the advice about it fold away until wanted, since most authors copy the
 * prompt as a preset filled it.
 */

export interface PromptStepProps {
  document: PromptDocument
  shape: CanvasShape
  onShapeChange(shape: CanvasShape): void
  /** What choosing a different shape would undo, said before it happens. */
  shapeChangeWarning?: string
  /**
   * The other way to a picture: a prompt per theme and view that asks an
   * assistant for an office drawn to the SVG convention, rooms included, so the
   * rooms step opens laid out. Absent, and only the picture prompt is offered.
   */
  officePrompts?: readonly OfficePrompt[]
}

/** The look of a choice among a few, pressed or not: shapes, themes and views. */
const choice = (pressed: boolean) =>
  [
    'rounded-lg border px-3 py-2 text-sm',
    'focus-visible:outline-2 focus-visible:outline-primary',
    pressed ? 'border-primary bg-primary/10 font-medium' : 'border-base-300 hover:bg-base-200',
  ].join(' ')

export function PromptStep(props: PromptStepProps) {
  const { document: prompt, shape } = props
  const [values, setValues] = useState<SlotValues>(() => defaultSlots(prompt))
  const [copied, setCopied] = useState<'picture' | 'office' | null>(null)
  const [officeId, setOfficeId] = useState<string | null>(props.officePrompts?.[0]?.id ?? null)

  const text = useMemo(() => renderPrompt(prompt, shape, values), [prompt, shape, values])
  const office = props.officePrompts?.find((candidate) => candidate.id === officeId) ?? null

  function copy(which: 'picture' | 'office', content: string) {
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(which)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  const picture = (
    <div className="grid gap-4 pt-3 lg:grid-cols-[1fr_18rem]">
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">The prompt</h2>
          <Button size="sm" variant="ghost" onClick={() => copy('picture', text)}>
            <Icon name={copied === 'picture' ? 'check' : 'copy'} size="sm" />
            {copied === 'picture' ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <p className="mt-1 text-sm text-base-content/75">
          Paste it into an image model, or hand it to an illustrator, and upload the picture on the
          next step.
        </p>
        {/*
          Read-only. The rules at the bottom are what make a picture usable as
          an office: no text, nothing tall on desks, seats drawn. An author
          editing those gets a nicer picture and a worse office.
        */}
        <Textarea
          readOnly
          value={text}
          rows={9}
          className="mt-2 font-mono text-xs"
          aria-label="The prompt"
        />
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Start from a theme</h3>
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

        {/*
          Folded until wanted: a preset fills every field, and most authors copy
          the prompt as it is. Open, the fields and the advice take the height
          the prompt itself does, not more.
        */}
        <Accordion
          type="multiple"
          variant="plus"
          headingLevel={3}
          items={[
            {
              value: 'fields',
              title: 'Adjust the prompt',
              content: (
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
              ),
            },
            {
              value: 'guidance',
              title: 'Worth knowing',
              content: (
                <ul className="list-disc space-y-1 pl-4 text-xs text-base-content/75">
                  {prompt.guidance.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ),
            },
          ]}
        />
      </div>
    </div>
  )

  /*
   * The same job done the other way round: instead of a painting the rooms
   * are drawn onto by hand, an SVG that carries its rooms, drawn by the
   * author's own assistant from a theme's symbols. The prompt is generated
   * from the spec and the symbols and only copied here, so what the
   * assistant is told and what the importer accepts cannot drift apart.
   */
  const drawn =
    props.officePrompts && props.officePrompts.length > 0 && office ? (
      <div className="pt-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Or have your AI draw the office</h2>
          <Button size="sm" variant="ghost" onClick={() => copy('office', office.text)}>
            <Icon name={copied === 'office' ? 'check' : 'copy'} size="sm" />
            {copied === 'office' ? 'Copied' : 'Copy'} office prompt
          </Button>
        </div>
        <p className="mt-1 text-sm text-base-content/75">
          Paste this into ChatGPT, Claude, Gemini or whichever assistant you use, answer its
          questions, and upload the SVG it returns on the next step. Its rooms come with it, so the
          rooms step opens already laid out.
        </p>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Theme and view">
          {props.officePrompts.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              onClick={() => setOfficeId(candidate.id)}
              aria-pressed={candidate.id === office.id}
              className={choice(candidate.id === office.id)}
            >
              {candidate.label}
            </button>
          ))}
        </div>
        <Textarea
          readOnly
          value={office.text}
          rows={9}
          className="mt-2 font-mono text-xs"
          aria-label="The office prompt"
        />
      </div>
    ) : null

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h2 className="text-base font-semibold">Shape of the office</h2>
          <div className="flex flex-wrap gap-2">
            {CANVAS_SHAPES.map((candidate) => (
              <button
                key={candidate}
                type="button"
                onClick={() => props.onShapeChange(candidate)}
                aria-pressed={shape === candidate}
                className={choice(shape === candidate)}
              >
                {prompt.canvases[candidate].label}
                {/*
                  Full-strength ink, not a faded tint. The selected button has a
                  tinted background, and faded small text on top of it drops
                  under AA contrast — the size and weight already carry the
                  hierarchy without borrowing from the contrast to do it.
                */}
                <span className="ms-2 text-xs text-base-content">
                  {prompt.canvases[candidate].resolution}
                </span>
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1 text-sm text-base-content/75">
          This cannot change once rooms are placed, because every room is positioned against it.
        </p>
        {props.shapeChangeWarning && (
          <Alert variant="warn" className="mt-3">
            {props.shapeChangeWarning}
          </Alert>
        )}
      </div>

      {drawn ? (
        <Tabs
          label="How to get the picture"
          variant="border"
          items={[
            { value: 'picture', label: 'Picture prompt', content: picture },
            { value: 'office', label: 'Office prompt: your AI draws the rooms', content: drawn },
          ]}
        />
      ) : (
        picture
      )}
    </div>
  )
}
