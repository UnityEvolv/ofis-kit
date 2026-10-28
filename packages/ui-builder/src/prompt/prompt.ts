import type { CanvasShape } from '@unityevolv/ofiskit-template'

/**
 * The background-image prompt, as data.
 *
 * The prompt itself lives in the repository as a versioned document that the
 * builder fetches and renders, rather than being compiled into this package.
 * That is deliberate: improving the prompt should reach every author and every
 * host immediately, without releasing the builder, and the prompt is the thing
 * most likely to be improved after a few people have used it.
 */

export interface PromptSlot {
  label: string
  help: string
  default: string
}

export interface PromptPreset {
  label: string
  theme: string
  style: string
  palette: string
  lighting: string
  areaNames: string
  entryEdge: string
}

export interface PromptDocument {
  version: number
  canvases: Record<CanvasShape, { label: string; ratio: string; resolution: string }>
  slots: Record<string, PromptSlot>
  /** The rules an author may not edit, because they are what make it usable. */
  fixed: string[]
  template: string
  guidance: string[]
  presets: Record<string, PromptPreset>
}

export type SlotValues = Record<string, string>

/** Every slot at its default, which is what the form opens with. */
export function defaultSlots(document: PromptDocument): SlotValues {
  return Object.fromEntries(
    Object.entries(document.slots).map(([key, slot]) => [key, slot.default]),
  )
}

/**
 * Fill the prompt in.
 *
 * The shape and resolution come from the canvas the author picked, so they can
 * never disagree with the template being built — which is the mistake that
 * produces an image that has to be regenerated after the rooms are drawn.
 */
export function renderPrompt(
  document: PromptDocument,
  shape: CanvasShape,
  values: SlotValues,
): string {
  const canvas = document.canvases[shape]

  const substitutions: Record<string, string> = {
    ...values,
    shape: canvas.label.toLocaleLowerCase(),
    ratio: canvas.ratio,
    resolution: canvas.resolution,
    fixed: document.fixed.map((rule) => `- ${rule}`).join('\n'),
  }

  return document.template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) =>
    Object.hasOwn(substitutions, key) ? (substitutions[key] ?? whole) : whole,
  )
}

/** Fill every slot from a preset, so an author with no idea still gets a good image. */
export function applyPreset(preset: PromptPreset): SlotValues {
  const { label: _label, ...slots } = preset
  return slots
}

/**
 * Load the prompt document.
 *
 * A path rather than a URL: the app serves it from its own origin, and no
 * hostname is ever written down in the product.
 */
export async function loadPromptDocument(path: string): Promise<PromptDocument> {
  const response = await fetch(path)
  if (!response.ok)
    throw new Error(`The background prompt could not be loaded (${response.status}).`)
  return (await response.json()) as PromptDocument
}

/**
 * A prompt that asks an assistant for an office drawn to the SVG convention,
 * in one theme and one view, with that theme's symbols inside it.
 *
 * Generated in the repository from the spec and the symbol libraries
 * (`npm run office:prompt`), never written by hand, so the prompt, the
 * designer guide and the importer cannot disagree. The builder only carries
 * them to the clipboard.
 */
export interface OfficePrompt {
  /** `<theme>-<view>`, the file name without its extension. */
  id: string
  theme: string
  view: 'cut' | 'top'
  /** For a person: "Modern office, cutaway". */
  label: string
  text: string
}

/** Load the office prompts, served beside the prompt document as one index. */
export async function loadOfficePrompts(path: string): Promise<OfficePrompt[]> {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`The office prompts could not be loaded (${response.status}).`)
  const index = (await response.json()) as { prompts: OfficePrompt[] }
  return index.prompts
}
