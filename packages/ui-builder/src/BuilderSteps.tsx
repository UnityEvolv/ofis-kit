import { Alert, Button, Icon, Stepper } from '@unityevolv/unitykit'
import { createTemplate, type CanvasShape, type Template } from '@unityevolv/ofiskit-template'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { OfficeBuilder } from './OfficeBuilder.js'
import { BackgroundStep, type BackgroundImages } from './background/BackgroundStep.js'
import { PromptStep } from './prompt/PromptStep.js'
import type { PromptDocument } from './prompt/prompt.js'

/**
 * The whole builder, as three steps: the prompt, the background, the rooms.
 *
 * Each step is one job. Writing a prompt for a picture, loading the picture, and
 * drawing rooms on it are different kinds of work, and on one screen the upload
 * sat under a long prompt and the drawing began without warning.
 *
 * Every step stays mounted and only the current one is shown, so moving back and
 * forth loses nothing: the prompt's fields, the images, and the rooms with their
 * undo history are all where they were left. The one thing that does start
 * again is the layout, and only when the shape changes, because every room is
 * placed relative to it.
 */

export interface BuilderStepsProps {
  document: PromptDocument
  /** What the host's save button says. Download here; Save elsewhere. */
  saveLabel: string
  /**
   * The finished template, with `images` naming the files as they are now, and the
   * images themselves as object URLs for a host that stores them.
   */
  onSave(template: Template, images: BackgroundImages): void
  /** Shown above the rooms: where the host's saved files go. */
  saveHint?(files: { light: string; dark?: string }): ReactNode
  initialShape?: CanvasShape
}

/*
 * Horizontal at every width, with the descriptions dropped on a phone: stacked
 * vertically, three steps took a quarter of the screen before any of the step
 * itself, and the one-word labels say enough on their own.
 */
const onWide = (text: string) => <span className="max-sm:hidden">{text}</span>

const STEPS = [
  { key: 'prompt', label: 'Prompt', description: onWide('Describe the picture') },
  {
    key: 'background',
    label: 'Background',
    description: onWide('Upload it, and a dark version'),
  },
  { key: 'rooms', label: 'Rooms', description: onWide('Place rooms and areas') },
]

const PROMPT = 0
const BACKGROUND = 1
const ROOMS = 2

export function BuilderSteps(props: BuilderStepsProps) {
  const [step, setStep] = useState(PROMPT)
  /** The furthest step reached, which the indicator lets the author jump back to. */
  const [reached, setReached] = useState(PROMPT)
  const [shape, setShape] = useState<CanvasShape>(props.initialShape ?? 'landscape')

  const [images, setImages] = useState<BackgroundImages>({ light: null, dark: null })
  // What the files are called beside template.json, keeping the type each was
  // uploaded as: an SVG background is office-light.svg, not a .webp name.
  const [files, setFiles] = useState({ light: 'office-light.webp', dark: 'office-dark.webp' })
  // Images are checked against the shape, so a new shape needs them again. The
  // key remounts the step, which clears what it was holding for the old ones.
  const [backgroundKey, setBackgroundKey] = useState(0)

  /** The layout the rooms step opened with; the builder keeps its own edits. */
  const [layout, setLayout] = useState<{ template: Template; key: number } | null>(null)

  /** The file names for the template: a dark one only when there is a dark image. */
  const namesFor = (current: typeof files) => ({
    light: current.light,
    ...(images.dark ? { dark: current.dark } : {}),
  })

  const canEnter = (index: number) => index !== ROOMS || images.light !== null

  function go(index: number) {
    if (index < PROMPT || index > ROOMS || !canEnter(index)) return
    if (index === ROOMS && (!layout || layout.template.canvas !== shape)) {
      setLayout({
        template: createTemplate({ name: 'My office', canvas: shape, images: namesFor(files) }),
        key: (layout?.key ?? 0) + 1,
      })
    }
    setStep(index)
    setReached((current) => Math.max(current, index))
  }

  function changeShape(next: CanvasShape) {
    if (next === shape) return
    setShape(next)
    if (images.light || images.dark) {
      setImages({ light: null, dark: null })
      setBackgroundKey((key) => key + 1)
      setReached((current) => Math.min(current, BACKGROUND))
    }
  }

  /*
   * Where focus goes when the step changes: to the step itself, so a screen
   * reader lands at the top of the new content instead of on a Next button that
   * now belongs to a different step. Not on the first render, which is the page
   * opening and should leave focus where the browser put it.
   */
  const panels = useRef<(HTMLElement | null)[]>([])
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    panels.current[step]?.focus()
  }, [step])

  const warning = [
    layout && 'You have already placed rooms. Choosing a different shape starts the layout again.',
    (images.light || images.dark) &&
      'Your images were checked against this shape, so a different one needs them uploaded again.',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-base-300 bg-base-100 px-4 py-3">
        <div className="mx-auto w-full max-w-3xl">
          <Stepper
            steps={STEPS}
            current={step}
            label="Office builder steps"
            orientation="horizontal"
            onStepClick={go}
            allowUpcoming={reached > step}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <section
          ref={(node) => {
            panels.current[PROMPT] = node
          }}
          tabIndex={-1}
          hidden={step !== PROMPT}
          aria-label="Prompt"
          className="outline-none"
        >
          <PromptStep
            document={props.document}
            shape={shape}
            onShapeChange={changeShape}
            {...(warning ? { shapeChangeWarning: warning } : {})}
          />
        </section>

        <section
          ref={(node) => {
            panels.current[BACKGROUND] = node
          }}
          tabIndex={-1}
          hidden={step !== BACKGROUND}
          aria-label="Background"
          className="outline-none"
        >
          <BackgroundStep
            key={backgroundKey}
            document={props.document}
            shape={shape}
            images={images}
            onImage={(slot, url, fileName) => {
              setImages((current) => ({ ...current, [slot]: url }))
              setFiles((current) => ({ ...current, [slot]: fileName }))
            }}
          />
        </section>

        <section
          ref={(node) => {
            panels.current[ROOMS] = node
          }}
          tabIndex={-1}
          hidden={step !== ROOMS}
          aria-label="Rooms"
          className="outline-none"
        >
          {layout && (
            <>
              {props.saveHint && (
                <Alert variant="info" className="mx-4 mt-4">
                  {props.saveHint(namesFor(files))}
                </Alert>
              )}
              <OfficeBuilder
                key={layout.key}
                template={layout.template}
                imageUrl={images.light}
                darkImageUrl={images.dark}
                saveLabel={props.saveLabel}
                // The names as they are now, not as they were when the layout
                // opened: the images may have been replaced since.
                onSave={(finished) =>
                  props.onSave({ ...finished, images: namesFor(files) }, images)
                }
                onPickImage={() => go(BACKGROUND)}
              />
            </>
          )}
        </section>
      </div>

      <nav
        aria-label="Builder steps"
        className="flex items-center gap-2 border-t border-base-300 bg-base-100 px-4 py-2"
      >
        {step > PROMPT && (
          <Button size="sm" variant="ghost" onClick={() => go(step - 1)}>
            <Icon name="chevron-left" size="sm" /> Back
          </Button>
        )}
        {step === BACKGROUND && !images.light && (
          <span className="ml-auto text-xs text-base-content/70">
            Add a background image to continue.
          </span>
        )}
        {step < ROOMS && (
          <Button
            size="sm"
            className={step === BACKGROUND && !images.light ? '' : 'ml-auto'}
            disabled={!canEnter(step + 1)}
            onClick={() => go(step + 1)}
          >
            Next: {STEPS[step + 1]?.label}
            <Icon name="chevron-right" size="sm" />
          </Button>
        )}
      </nav>
    </div>
  )
}
