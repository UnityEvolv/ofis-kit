import { Alert, Button, Field } from '@unityevolv/unitykit'
import type { CanvasShape } from '@unityevolv/ofiskit-template'
import { useEffect, useState } from 'react'

import type { PromptDocument } from '../prompt/prompt.js'
import { darkVersion } from './darkVersion.js'

/**
 * Step two: the picture the office is drawn on.
 *
 * The light image is required and the dark one is optional. When the light image
 * is an SVG, the dark one can be generated from it here instead of being made
 * separately, which is also the one way to be sure the two pictures show the same
 * office.
 *
 * Each image is checked on the way in, against the shape chosen in step one: a
 * picture of the wrong ratio puts every room slightly wrong against it, and
 * finding that out here costs one regeneration rather than a whole layout.
 */

export interface BackgroundImages {
  /** Object URLs of what is loaded so far. */
  light: string | null
  dark: string | null
}

export interface BackgroundStepProps {
  document: PromptDocument
  shape: CanvasShape
  /** What is loaded now, to preview. */
  images: BackgroundImages
  /**
   * An image came in, with the name it should have in the host's config folder.
   * The name keeps the type it was uploaded as: `office-light.svg` for an SVG,
   * not a `.webp` name for a file that is not one.
   */
  onImage(slot: 'light' | 'dark', url: string, fileName: string): void
}

/** The name a background should have beside template.json, keeping its type. */
export function backgroundFileName(file: File, slot: 'light' | 'dark'): string {
  const extension = isSvg(file) ? 'svg' : (/\.([a-z0-9]+)$/i.exec(file.name)?.[1] ?? 'png')
  return `office-${slot}.${extension.toLowerCase()}`
}

function isSvg(file: File): boolean {
  return file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)
}

export function BackgroundStep(props: BackgroundStepProps) {
  const { document: prompt, shape } = props
  const canvas = prompt.canvases[shape]

  const [problem, setProblem] = useState<string | null>(null)
  /** The light image, when it is an SVG: the only kind a dark version can be made from. */
  const [lightSvg, setLightSvg] = useState<File | null>(null)
  /** A dark version made here, which the author needs as a file; they never had one. */
  const [generated, setGenerated] = useState<{ url: string; name: string } | null>(null)
  const [generating, setGenerating] = useState(false)

  // The download link's URL is this step's own; the one handed to the host is not.
  useEffect(
    () => () => {
      if (generated) URL.revokeObjectURL(generated.url)
    },
    [generated],
  )

  /** Check an image against the canvas, and hand it to the host if it fits. */
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

    const wanted = canvas.ratio.split(':').map(Number)
    const target = (wanted[0] ?? 1) / (wanted[1] ?? 1)
    const actual = image.width / image.height

    if (Math.abs(actual - target) > 0.03) {
      setProblem(
        `That image is ${image.width}x${image.height}, which is not ${canvas.ratio}. ` +
          `Rooms would sit slightly wrong against it. Generate it at ${canvas.resolution}.`,
      )
      URL.revokeObjectURL(url)
      return false
    }

    setProblem(
      image.width < 1200
        ? `That image is only ${image.width} pixels wide. It will look soft on a large screen.`
        : null,
    )

    if (slot === 'light') {
      // A new light picture makes any dark version made from the old one stale.
      setLightSvg(isSvg(file) ? file : null)
    }
    // Replaced by whatever came in now; generating sets it again straight after.
    setGenerated(null)
    props.onImage(slot, url, backgroundFileName(file, slot))
    return true
  }

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

  return (
    <div className="mx-auto grid max-w-5xl gap-6 p-4 lg:grid-cols-2">
      <section className="space-y-3" aria-labelledby="background-light">
        <h2 id="background-light" className="text-lg font-semibold">
          Background image
        </h2>
        <p className="text-sm text-base-content/75">
          Required. The office is drawn on this. It should be {canvas.ratio}, ideally{' '}
          {canvas.resolution}.
        </p>

        {/*
          A file input is the one control here the kit does not wrap, so these
          take Field's render-prop form and spread what it gives them. That is
          what associates the label with the input; a label on the wrapper alone
          points at nothing.
        */}
        <Field label="Light image" help="PNG, JPEG, WebP, AVIF or SVG.">
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

        <Preview url={props.images.light} label="The light image" />
      </section>

      <section className="space-y-3" aria-labelledby="background-dark">
        <h2 id="background-dark" className="text-lg font-semibold">
          Dark version
        </h2>
        <p className="text-sm text-base-content/75">
          Optional, for the dark theme. The same scene recoloured, never a different layout.
        </p>

        <Field label="Dark image" help="Upload one, or generate it from an SVG.">
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

        <Preview url={props.images.dark} label="The dark image" />
      </section>

      {problem && (
        <Alert variant="warn" className="lg:col-span-2">
          {problem}
        </Alert>
      )}
    </div>
  )
}

/** What is loaded, so the author can see it is the right picture before drawing on it. */
function Preview({ url, label }: { url: string | null; label: string }) {
  if (!url) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-base-300 text-xs text-base-content/60">
        Nothing yet
      </div>
    )
  }
  return (
    <img
      src={url}
      alt={label}
      className="aspect-video w-full rounded-lg border border-base-300 object-contain"
    />
  )
}
