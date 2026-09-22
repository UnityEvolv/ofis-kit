import { Alert, Button, Field, Icon, Input, Textarea } from '@unityevolv/unitykit'
import { CANVAS_SHAPES, type CanvasShape } from '@unityevolv/ofiskit-template'
import { useEffect, useMemo, useState } from 'react'

import { darkVersion } from './darkVersion.js'
import {
  applyPreset,
  defaultSlots,
  renderPrompt,
  type PromptDocument,
  type SlotValues,
} from './prompt.js'

/**
 * Step one, before a single room is drawn: get the picture.
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
  /**
   * The light image, and optionally the dark one. Both are object URLs here.
   *
   * With each, the name the file should have in the host's config folder, which
   * keeps the type it was uploaded as: `office-light.svg` for an SVG, not a
   * `.webp` name for a file that is not one.
   */
  onImages(images: { light: string; dark?: string; lightFile?: string; darkFile?: string }): void
  onContinue(): void
  hasLightImage: boolean
}

/** The name a background should have beside template.json, keeping its type. */
export function backgroundFileName(file: File, slot: 'light' | 'dark'): string {
  const extension = isSvg(file) ? 'svg' : (/\.([a-z0-9]+)$/i.exec(file.name)?.[1] ?? 'png')
  return `office-${slot}.${extension.toLowerCase()}`
}

function isSvg(file: File): boolean {
  return file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)
}

export function PromptStep(props: PromptStepProps) {
  const { document: prompt, shape } = props
  const [values, setValues] = useState<SlotValues>(() => defaultSlots(prompt))
  const [copied, setCopied] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  /** The light image, when it is an SVG: the only kind a dark version can be made from. */
  const [lightSvg, setLightSvg] = useState<File | null>(null)
  /** A dark version made here, which the author needs as a file; they never had one. */
  const [generated, setGenerated] = useState<{ url: string; name: string } | null>(null)
  const [generating, setGenerating] = useState(false)

  const text = useMemo(() => renderPrompt(prompt, shape, values), [prompt, shape, values])

  // The download link's URL is this step's own; the one handed to the host is not.
  useEffect(
    () => () => {
      if (generated) URL.revokeObjectURL(generated.url)
    },
    [generated],
  )

  /**
   * Make the dark version from the light SVG, and put it in the dark slot.
   *
   * Through the same checks as an uploaded file, so a generated picture is held to
   * the same shape as one somebody made by hand.
   */
  async function generateDark() {
    if (!lightSvg) return
    setGenerating(true)
    try {
      const svg = darkVersion(await lightSvg.text())
      const name = backgroundFileName(lightSvg, 'dark')
      const file = new File([svg], name, { type: 'image/svg+xml' })
      if (await accept(file, 'dark')) {
        setGenerated({ url: URL.createObjectURL(file), name })
      }
    } catch (cause) {
      setProblem(
        `The dark version could not be made: ${cause instanceof Error ? cause.message : 'unknown'}.`,
      )
    } finally {
      setGenerating(false)
    }
  }

  /**
   * Check the image before anything is drawn on it.
   *
   * The ratio has to match the canvas, or every room the author places will be
   * slightly wrong against the picture underneath. Catching it here costs them
   * one regeneration; catching it later costs them the whole layout.
   */
  async function accept(file: File, slot: 'light' | 'dark'): Promise<boolean> {
    const url = URL.createObjectURL(file)
    const image = new Image()

    const ok = await new Promise<boolean>((resolve) => {
      image.onload = () => resolve(true)
      image.onerror = () => resolve(false)
      image.src = url
    })

    if (!ok) {
      setProblem('That file could not be read as an image.')
      URL.revokeObjectURL(url)
      return false
    }

    const wanted = prompt.canvases[shape].ratio.split(':').map(Number)
    const target = (wanted[0] ?? 1) / (wanted[1] ?? 1)
    const actual = image.width / image.height

    if (Math.abs(actual - target) > 0.03) {
      setProblem(
        `That image is ${image.width}x${image.height}, which is not ${prompt.canvases[shape].ratio}. ` +
          `Rooms would sit slightly wrong against it. Generate it at ${prompt.canvases[shape].resolution}.`,
      )
      URL.revokeObjectURL(url)
      return false
    }

    if (image.width < 1200) {
      setProblem(
        `That image is only ${image.width} pixels wide. It will look soft on a large screen.`,
      )
    } else {
      setProblem(null)
    }

    const name = backgroundFileName(file, slot)
    if (slot === 'light') {
      // A new light picture makes any dark version made from the old one stale.
      setLightSvg(isSvg(file) ? file : null)
      setGenerated(null)
      props.onImages({ light: url, lightFile: name })
    } else {
      // Replaced by whatever came in now; generating sets it again straight after.
      setGenerated(null)
      props.onImages({ light: '', dark: url, darkFile: name })
    }
    return true
  }

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

        {problem && <Alert variant="warn">{problem}</Alert>}

        {/*
          A file input is the one control here the kit does not wrap, so these
          two take Field's render-prop form and spread what it gives them. That
          is what associates the label with the input; a label on the wrapper
          alone points at nothing.
        */}
        <div className="space-y-2">
          <Field label="Background image" help="Required. The office is drawn on this.">
            {(control) => (
              <input
                {...control}
                type="file"
                accept="image/*"
                className="file-input file-input-bordered file-input-sm w-full"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void accept(file, 'light')
                }}
              />
            )}
          </Field>

          <Field
            label="Dark version"
            help="Optional. The same scene recoloured, never a different layout."
          >
            {(control) => (
              <input
                {...control}
                type="file"
                accept="image/*"
                className="file-input file-input-bordered file-input-sm w-full"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void accept(file, 'dark')
                }}
              />
            )}
          </Field>

          {/*
            Only for an SVG: its colours are text and can be rewritten, where a
            photo's would need a filter that dims the lamps along with the walls.
          */}
          {lightSvg && (
            <div className="space-y-1">
              <Button
                size="sm"
                variant="secondary"
                className="w-full"
                disabled={generating}
                onClick={() => void generateDark()}
              >
                Generate dark version
              </Button>
              <p className="text-xs text-base-content/70">
                Made from your SVG: walls and floors darken, lamps stay lit. Nothing is uploaded.
              </p>
            </div>
          )}

          <p role="status" className="text-xs">
            {generated && (
              <>
                Dark version ready.{' '}
                <a href={generated.url} download={generated.name} className="link">
                  Download {generated.name}
                </a>{' '}
                and put it beside template.json.
              </>
            )}
          </p>
        </div>

        <Button className="w-full" disabled={!props.hasLightImage} onClick={props.onContinue}>
          Start drawing rooms
        </Button>
      </div>
    </div>
  )
}
