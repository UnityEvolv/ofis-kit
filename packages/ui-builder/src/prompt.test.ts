import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CANVAS_SHAPES } from '@unityevolv/ofiskit-template'
import { beforeAll, describe, expect, it } from 'vitest'

import { applyPreset, defaultSlots, renderPrompt, type PromptDocument } from './prompt.js'

/**
 * The prompt document, read from the repository rather than from a fixture.
 *
 * Deliberately the real file: the whole arrangement is that the document can be
 * improved without releasing the builder, which means nothing checks it at build
 * time and a typo in a slot name would reach every author. This is the only
 * thing standing between an edit to that file and a builder that renders
 * `{{theme}}` at somebody.
 */
const here = dirname(fileURLToPath(import.meta.url))
const documentPath = join(here, '..', '..', '..', 'docs', 'background-prompt.json')

let prompt: PromptDocument

beforeAll(async () => {
  prompt = JSON.parse(await readFile(documentPath, 'utf8')) as PromptDocument
})

describe('the background prompt document', () => {
  it('has a canvas for every shape the schema allows', () => {
    // An author who picks portrait and is handed a 16:9 resolution regenerates
    // the image after drawing the whole layout.
    for (const shape of CANVAS_SHAPES) {
      expect(prompt.canvases[shape]).toMatchObject({
        label: expect.any(String),
        ratio: expect.stringMatching(/^\d+:\d+$/),
        resolution: expect.stringMatching(/^\d+x\d+$/),
      })
    }
  })

  it('leaves no placeholder unfilled once rendered', () => {
    for (const shape of CANVAS_SHAPES) {
      const text = renderPrompt(prompt, shape, defaultSlots(prompt))
      expect(text).not.toMatch(/\{\{\w+\}\}/)
    }
  })

  it('fills in the shape and resolution from the canvas, not from the author', () => {
    const portrait = renderPrompt(prompt, 'portrait', defaultSlots(prompt))
    expect(portrait).toContain(prompt.canvases.portrait.ratio)
    expect(portrait).toContain(prompt.canvases.portrait.resolution)
    expect(portrait).not.toContain(prompt.canvases.landscape.resolution)
  })

  it('carries every fixed rule into the prompt', () => {
    const text = renderPrompt(prompt, 'landscape', defaultSlots(prompt))
    expect(prompt.fixed.length).toBeGreaterThan(0)
    for (const rule of prompt.fixed) expect(text).toContain(rule)
  })

  it('says no text in the image, because the product draws the room names', () => {
    const text = renderPrompt(prompt, 'landscape', defaultSlots(prompt)).toLowerCase()
    expect(text).toMatch(/no text|no words|no lettering/)
  })

  it('gives every preset a value for every slot', () => {
    // A preset that leaves a slot behind is worse than no preset: it produces a
    // prompt that is half one theme and half the default.
    expect(Object.keys(prompt.presets).length).toBeGreaterThan(0)
    for (const [name, preset] of Object.entries(prompt.presets)) {
      const filled = applyPreset(preset)
      for (const slot of Object.keys(prompt.slots)) {
        expect(filled[slot], `${name} is missing ${slot}`).toBeTruthy()
      }
    }
  })

  it('renders a preset into the prompt in place of the defaults', () => {
    const first = Object.values(prompt.presets)[0]
    expect(first).toBeDefined()
    if (!first) return

    const text = renderPrompt(prompt, 'landscape', applyPreset(first))
    expect(text).toContain(first.theme)
  })

  it('leaves a placeholder alone when nothing fills it', () => {
    // So a slot renamed in the document shows up as an obvious `{{gap}}` rather
    // than as a silently empty sentence.
    const partial = { ...defaultSlots(prompt) }
    const text = renderPrompt({ ...prompt, template: 'A {{gap}} office.' }, 'square', partial)
    expect(text).toBe('A {{gap}} office.')
  })
})
