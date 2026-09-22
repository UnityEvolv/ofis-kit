import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Template } from '@unityevolv/ofiskit-template'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { BuilderSteps } from './BuilderSteps.js'
import type { PromptDocument } from './prompt/prompt.js'

/**
 * The builder as three steps, from the outside: where you are, what lets you
 * move on, and — the point of keeping every step mounted — what survives moving
 * back and forth.
 *
 * jsdom decodes no images and makes no object URLs, so each image "loads" at
 * 2560x1440 and each object URL is a counter. Its Blob has no `text()` either,
 * which every browser the builder runs in does, so that is stood in for with the
 * FileReader jsdom has. Only the visible step is queried: hidden steps are out of
 * the accessibility tree, as they are for a person.
 */

const here = dirname(fileURLToPath(import.meta.url))
let prompt: PromptDocument

beforeAll(async () => {
  const path = join(here, '..', '..', '..', 'docs', 'background-prompt.json')
  prompt = JSON.parse(await readFile(path, 'utf8')) as PromptDocument
  if (typeof Blob.prototype.text !== 'function') {
    Blob.prototype.text = function text(this: Blob) {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error ?? new Error('unreadable'))
        reader.readAsText(this)
      })
    }
  }
})

let urls = 0

beforeEach(() => {
  urls = 0
  vi.stubGlobal(
    'Image',
    class {
      width = 2560
      height = 1440
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_url: string) {
        queueMicrotask(() => this.onload?.())
      }
    },
  )
  URL.createObjectURL = vi.fn(() => `blob:${++urls}`)
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function open() {
  const onSave = vi.fn<(template: Template) => void>()
  render(<BuilderSteps document={prompt} saveLabel="Download template.json" onSave={onSave} />)
  return { onSave, person: userEvent.setup() }
}

const svg = (name = 'office.svg') =>
  new File(['<svg viewBox="0 0 2560 1440"><rect fill="#fbf6ee"/></svg>'], name, {
    type: 'image/svg+xml',
  })

async function uploadLight(file: File) {
  fireEvent.change(screen.getByLabelText(/^Light image/), { target: { files: [file] } })
  await screen.findByRole('img', { name: 'The light image' })
}

const next = (label: string) => screen.getByRole('button', { name: `Next: ${label}` })
const back = () => screen.getByRole('button', { name: 'Back' })
const current = () =>
  within(screen.getByRole('list', { name: 'Office builder steps' }))
    .getAllByRole('listitem')
    .findIndex(
      (item) =>
        item.querySelector('[aria-current="step"]') ?? item.getAttribute('aria-current') === 'step',
    )

/** Straight through to the rooms, with an SVG background. */
async function toRooms(person: ReturnType<typeof userEvent.setup>) {
  await person.click(next('Background'))
  await uploadLight(svg())
  await person.click(next('Rooms'))
  await screen.findByRole('list', { name: 'Rooms' })
}

describe('the builder, in three steps', () => {
  it('shows the three steps, and starts on the prompt', () => {
    open()
    const steps = within(screen.getByRole('list', { name: 'Office builder steps' }))

    expect(steps.getByText('Prompt')).toBeInTheDocument()
    expect(steps.getByText('Background')).toBeInTheDocument()
    expect(steps.getByText('Rooms')).toBeInTheDocument()
    expect(current()).toBe(0)
    expect(screen.getByRole('textbox', { name: 'The prompt' })).toBeInTheDocument()
  })

  it('will not go on to the rooms without a background to draw them on', async () => {
    const { person } = open()
    await person.click(next('Background'))

    expect(current()).toBe(1)
    expect(next('Rooms')).toBeDisabled()
    expect(screen.getByText('Add a background image to continue.')).toBeInTheDocument()

    await uploadLight(svg())
    expect(next('Rooms')).toBeEnabled()
  })

  it('opens the rooms with a layout already started', async () => {
    const { person } = open()
    await toRooms(person)

    expect(current()).toBe(2)
    expect(within(screen.getByRole('list', { name: 'Rooms' })).getAllByRole('button')).toHaveLength(
      3,
    )
  })

  it('moves focus to the step it opens, so a screen reader starts at the top', async () => {
    const { person } = open()
    await person.click(next('Background'))

    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Background' }))
  })
})

describe('what survives moving between steps', () => {
  it('keeps what was typed into the prompt', async () => {
    const { person } = open()
    const field = screen
      .getAllByRole('textbox')
      .find((one) => one.getAttribute('aria-label') !== 'The prompt')!
    await person.clear(field)
    await person.type(field, 'a lighthouse')

    await person.click(next('Background'))
    await person.click(back())

    expect(field).toHaveValue('a lighthouse')
  })

  it('keeps the rooms when the image is replaced', async () => {
    const { person } = open()
    await toRooms(person)

    const rooms = () => within(screen.getByRole('list', { name: 'Rooms' }))
    await person.click(rooms().getByRole('button', { name: /workspace/i }))
    await person.click(screen.getByRole('button', { name: /delete room/i }))
    expect(rooms().getAllByRole('button')).toHaveLength(2)

    // The builder's own way back to the images, and the stepper's way forward.
    await person.click(screen.getByRole('button', { name: 'Replace image' }))
    expect(current()).toBe(1)
    await uploadLight(svg('another.svg'))
    await person.click(next('Rooms'))

    expect(rooms().getAllByRole('button')).toHaveLength(2)
  })

  it('lets the stepper jump back to a step already finished', async () => {
    const { person } = open()
    await toRooms(person)

    await person.click(screen.getByRole('button', { name: /Prompt/ }))
    expect(current()).toBe(0)
  })
})

describe('what gets saved', () => {
  it('names the images as they are when saving, not as they were when drawing began', async () => {
    const { person, onSave } = open()
    await person.click(next('Background'))
    await uploadLight(new File(['png'], 'first.png', { type: 'image/png' }))
    await person.click(next('Rooms'))
    await screen.findByRole('list', { name: 'Rooms' })

    await person.click(screen.getByRole('button', { name: 'Replace image' }))
    await uploadLight(svg())
    await person.click(next('Rooms'))
    await person.click(screen.getByRole('button', { name: /Download template.json/ }))

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0]?.[0].images).toEqual({ light: 'office-light.svg' })
  })

  it('names a generated dark version alongside the light one', async () => {
    const { person, onSave } = open()
    await person.click(next('Background'))
    await uploadLight(svg())
    await person.click(screen.getByRole('button', { name: 'Generate dark version' }))
    await screen.findByRole('link', { name: 'Download office-dark.svg' })
    await person.click(next('Rooms'))
    await person.click(await screen.findByRole('button', { name: /Download template.json/ }))

    expect(onSave.mock.calls[0]?.[0].images).toEqual({
      light: 'office-light.svg',
      dark: 'office-dark.svg',
    })
  })
})

describe('changing the shape', () => {
  it('says what it would undo before it happens', async () => {
    const { person } = open()
    await toRooms(person)
    await person.click(screen.getByRole('button', { name: /Prompt/ }))

    expect(screen.getByText(/starts the layout again/)).toBeInTheDocument()
  })

  it('asks for the images again, since they were checked against the old shape', async () => {
    const { person } = open()
    await person.click(next('Background'))
    await uploadLight(svg())
    await person.click(back())

    const other = screen
      .getAllByRole('button', { pressed: false })
      .find((one) => /\d+x\d+/.test(one.textContent ?? ''))!
    await person.click(other)
    await person.click(next('Background'))

    await waitFor(() => expect(next('Rooms')).toBeDisabled())
    expect(screen.queryByRole('img', { name: 'The light image' })).toBeNull()
  })
})
