import { Alert, Button, Field } from '@unityevolv/unitykit'
import type { CanvasShape } from '@unityevolv/ofiskit-template'
import { useEffect, useState } from 'react'

import type { PromptDocument } from '../prompt/prompt.js'
import { darkVersion } from './darkVersion.js'
import {
  describeFound,
  firstMovedRoom,
  importOfficeFile,
  type ImportedOffice,
} from './officeImport.js'

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
 *
 * An SVG is read as well as looked at. One that carries its rooms (see
 * docs/office-svg/spec.md) hands them to the host, and the rooms step opens
 * already laid out; one that carries something that must not be shown to an
 * office's members is refused with the element named. A plain SVG is a picture,
 * as it always was.
 */

export interface BackgroundImages {
  /** Object URLs of what is loaded so far. */
  light: string | null
  dark: string | null
}

/** A light SVG that brought its rooms with it. */
export type OfficeFromPicture = Extract<ImportedOffice, { kind: 'office' }>

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
  /**
   * The light image carried its rooms, or (null) a new light image did not. Sent
   * after `onImage`, so a host that ignores it still has the picture.
   */
  onOffice?(office: OfficeFromPicture | null): void
}

/**
 * The bounds a raster background is held to, per canvas shape: the exact
 * ratio, because every room is placed in normalised coordinates against the
 * picture and nothing is cropped for the author, and a resolution between a
 * sharp tablet and a 4K wall. A host that stores pictures (the office
 * service) holds them to the same bounds, so a picture accepted here is
 * never refused later. An SVG scales: its ratio may be off by `RATIO_TOLERANCE`
 * and it has no resolution.
 */
export const BACKGROUND_BOUNDS: Readonly<
  Record<
    CanvasShape,
    {
      ratio: readonly [number, number]
      min: readonly [number, number]
      max: readonly [number, number]
    }
  >
> = {
  landscape: { ratio: [16, 9], min: [1920, 1080], max: [3840, 2160] },
  square: { ratio: [1, 1], min: [1080, 1080], max: [2160, 2160] },
  portrait: { ratio: [3, 4], min: [1080, 1440], max: [2160, 2880] },
}

/** How far an SVG's ratio may be from the canvas's: the office-svg spec's ratioTolerance. */
export const RATIO_TOLERANCE = 0.03

const size = ([width, height]: readonly [number, number]) => `${width}x${height}`

/**
 * Why a picture of width x height cannot be the background of a canvas, in
 * the author's words, or null when it can. The recommended resolution comes
 * from the prompt document, which is what the author was told to generate.
 */
export function backgroundProblem(
  shape: CanvasShape,
  canvas: { ratio: string; resolution: string },
  width: number,
  height: number,
  svg: boolean,
): string | null {
  const bounds = BACKGROUND_BOUNDS[shape]
  const [ratioWidth, ratioHeight] = bounds.ratio
  if (svg) {
    const target = ratioWidth / ratioHeight
    if (Math.abs(width / height - target) / target > RATIO_TOLERANCE) {
      return `That picture is ${width}x${height}, which is not ${canvas.ratio}. Rooms would sit wrong against it; draw it to ${canvas.ratio}.`
    }
    return null
  }
  if (width * ratioHeight !== height * ratioWidth) {
    return `That image is ${width}x${height}, which is not exactly ${canvas.ratio}. Rooms would sit wrong against it. Generate it at ${canvas.resolution}, or crop it to ${canvas.ratio}.`
  }
  if (width < bounds.min[0] || height < bounds.min[1]) {
    return `That image is ${width}x${height}, smaller than ${size(bounds.min)}. It would look soft on a large screen. Generate it at ${canvas.resolution}.`
  }
  if (width > bounds.max[0] || height > bounds.max[1]) {
    return `That image is ${width}x${height}, larger than ${size(bounds.max)}. Scale it down to ${canvas.resolution}.`
  }
  return null
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
  /** The rooms the light image carried, which a dark image is held to. */
  const [lightOffice, setLightOffice] = useState<OfficeFromPicture | null>(null)
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
    // An SVG is read before it is shown: what it carries decides what happens
    // next, and a refused one is never shown at all.
    let office: ImportedOffice | null = null
    if (isSvg(file)) {
      office = importOfficeFile(await file.text(), backgroundFileName(file, slot))
      if (office.kind === 'refused') {
        setProblem(
          `That file cannot be used as a background. ${office.issues
            .map((issue) => issue.message)
            .join(' ')}`,
        )
        return false
      }
      if (slot === 'dark' && lightOffice) {
        // The dark variant is a recolouring of the same scene, never a different
        // layout: the rooms it carries must be the rooms the light one carries.
        const moved =
          office.kind === 'office'
            ? firstMovedRoom(lightOffice.template, office.template)
            : 'every room'
        if (moved !== null) {
          setProblem(
            `The dark picture does not carry the same rooms as the light one (${moved}). Export both from the same frames, or generate the dark version here.`,
          )
          return false
        }
      }
    }

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

    const refused = backgroundProblem(shape, canvas, image.width, image.height, isSvg(file))
    if (refused) {
      setProblem(refused)
      URL.revokeObjectURL(url)
      return false
    }
    setProblem(null)

    if (slot === 'light') {
      // A new light picture makes any dark version made from the old one stale.
      setLightSvg(isSvg(file) ? file : null)
    }
    // Replaced by whatever came in now; generating sets it again straight after.
    setGenerated(null)
    props.onImage(slot, url, backgroundFileName(file, slot))

    if (slot === 'light') {
      const carried = office?.kind === 'office' ? office : null
      setLightOffice(carried)
      props.onOffice?.(carried)
    }
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
          Required. The office is drawn on this. A picture is exactly {canvas.ratio}, between{' '}
          {size(BACKGROUND_BOUNDS[shape].min)} and {size(BACKGROUND_BOUNDS[shape].max)}; generate it
          at {canvas.resolution}. An SVG drawn to the office convention brings its rooms with it.
        </p>

        {/*
          A file input is the one control here the kit does not wrap, so these
          take Field's render-prop form and spread what it gives them. That is
          what associates the label with the input; a label on the wrapper alone
          points at nothing.
        */}
        <Field label="Light image" help="PNG, JPEG, WebP or SVG.">
          {(control) => (
            <input
              {...control}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="file-input file-input-bordered file-input-sm w-full"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void accept(file, 'light')
              }}
            />
          )}
        </Field>

        <Preview url={props.images.light} label="The light image" />

        {lightOffice && (
          <div role="status" className="text-xs">
            <p className="font-medium text-success">{describeFound(lightOffice.found)}</p>
            <p className="text-base-content/75">
              They are placed for you on the next step
              {lightOffice.issues.length > 0 &&
                `, with ${lightOffice.issues.length} thing${lightOffice.issues.length === 1 ? '' : 's'} to fix shown there`}
              .
            </p>
            <Report issues={lightOffice.issues} warnings={lightOffice.warnings} />
          </div>
        )}
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
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
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

/** Every message, each on its own line, so the list copies cleanly. */
function Report({
  issues,
  warnings,
}: {
  issues: { message: string }[]
  warnings: { message: string }[]
}) {
  if (issues.length === 0 && warnings.length === 0) return null
  return (
    <ul className="mt-1 list-disc space-y-0.5 pl-4">
      {issues.map((issue, index) => (
        <li key={`issue-${index}`}>{issue.message}</li>
      ))}
      {warnings.map((warning, index) => (
        <li key={`warning-${index}`} className="text-base-content/70">
          {warning.message}
        </li>
      ))}
    </ul>
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
