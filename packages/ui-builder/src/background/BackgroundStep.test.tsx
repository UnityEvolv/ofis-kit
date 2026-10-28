import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PromptDocument } from '../prompt/prompt.js'
import { BackgroundStep, backgroundFileName } from './BackgroundStep.js'

/**
 * The background step's dark version: offered for an SVG and only an SVG, made in the
 * browser, put in the dark slot, and handed back as a file to keep.
 *
 * jsdom decodes no images and makes no object URLs, so both are stood in for:
 * every image "loads" at 2560x1440, and every object URL is a counter. Nor does
 * its Blob have `text()`, which every browser the builder runs in does; that is
 * stood in for with the FileReader jsdom does have.
 */

const here = dirname(fileURLToPath(import.meta.url))
let prompt: PromptDocument

beforeAll(async () => {
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

  const path = join(here, '..', '..', '..', '..', 'docs', 'background-prompt.json')
  prompt = JSON.parse(await readFile(path, 'utf8')) as PromptDocument
})

const made: Blob[] = []

beforeEach(() => {
  made.length = 0
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
  URL.createObjectURL = vi.fn((blob: Blob) => {
    made.push(blob)
    return `blob:${made.length}`
  })
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const LIGHT_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2560 1440"><rect fill="#fbf6ee"/></svg>'

/** An office drawn to the convention: two rooms, one with an area, on the stub's 2560x1440. */
const marked = (rooms: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2560 1440" data-ofis="1" data-canvas="landscape" data-avatar="small">
  <g id="rooms">${rooms}</g></svg>`
const RECEPTION = `<g id="room-reception-Reception"><rect x="100" y="800" width="900" height="500" fill="#fbf6ee"/>
  <rect id="area-4x1" x="200" y="900" width="480" height="160" fill="none"/></g>`
const CAFE = (x = 1400) =>
  `<g id="room-break-Cafe"><rect x="${x}" y="800" width="900" height="500" fill="#e3ece2"/></g>`
const OFFICE_SVG = marked(RECEPTION + CAFE())

function step() {
  const onImage = vi.fn()
  const onOffice = vi.fn()
  render(
    <BackgroundStep
      document={prompt}
      shape="landscape"
      images={{ light: null, dark: null }}
      onImage={onImage}
      onOffice={onOffice}
    />,
  )
  return { onImage, onOffice }
}

function upload(file: File, slot: 'Light' | 'Dark' = 'Light') {
  fireEvent.change(screen.getByLabelText(new RegExp(`^${slot} image`)), {
    target: { files: [file] },
  })
}

describe('a picture that carries its rooms', () => {
  it('hands the rooms to the host and says what it found', async () => {
    const { onImage, onOffice } = step()
    upload(new File([OFFICE_SVG], 'office.svg', { type: 'image/svg+xml' }))

    await waitFor(() => expect(onImage).toHaveBeenCalledWith('light', 'blob:1', 'office-light.svg'))
    await waitFor(() => expect(onOffice).toHaveBeenCalledTimes(1))
    const office = onOffice.mock.calls[0]?.[0]
    expect(office.kind).toBe('office')
    expect(office.found).toEqual({ rooms: 2, areas: 1 })
    expect(office.template.rooms.map((room: { name: string }) => room.name)).toEqual([
      'Reception',
      'Cafe',
    ])
    expect(screen.getByText('2 rooms and 1 user area found in the picture.')).toBeInTheDocument()
  })

  it('says a plain picture carries none, so a host can forget an earlier office', async () => {
    const { onOffice } = step()
    upload(new File([OFFICE_SVG], 'office.svg', { type: 'image/svg+xml' }))
    await waitFor(() => expect(onOffice).toHaveBeenCalledTimes(1))

    upload(new File([LIGHT_SVG], 'plain.svg', { type: 'image/svg+xml' }))
    await waitFor(() => expect(onOffice).toHaveBeenLastCalledWith(null))
  })

  it('refuses a file that cannot be shown safely, with the element named', async () => {
    const { onImage, onOffice } = step()
    upload(new File([marked(RECEPTION + CAFE() + '<script/>')], 'x.svg', { type: 'image/svg+xml' }))

    expect(await screen.findByText(/cannot be used as a background/)).toHaveTextContent('<script>')
    expect(onImage).not.toHaveBeenCalled()
    expect(onOffice).not.toHaveBeenCalled()
    expect(screen.queryByRole('img', { name: 'The light image' })).toBeNull()
  })

  it('holds a dark image to the rooms the light one carries', async () => {
    const { onImage } = step()
    upload(new File([OFFICE_SVG], 'office.svg', { type: 'image/svg+xml' }))
    await waitFor(() => expect(onImage).toHaveBeenCalledTimes(1))

    upload(
      new File([marked(RECEPTION + CAFE(1460))], 'dark.svg', { type: 'image/svg+xml' }),
      'Dark',
    )
    expect(await screen.findByText(/does not carry the same rooms/)).toHaveTextContent('Cafe')
    expect(onImage).toHaveBeenCalledTimes(1)

    upload(new File([OFFICE_SVG], 'dark.svg', { type: 'image/svg+xml' }), 'Dark')
    await waitFor(() =>
      expect(onImage).toHaveBeenLastCalledWith('dark', 'blob:2', 'office-dark.svg'),
    )
  })

  it('reports on a checked file without loading it', async () => {
    const { onImage } = step()
    fireEvent.change(screen.getByLabelText(/^File to check/), {
      target: {
        files: [new File([marked(RECEPTION + RECEPTION)], 'twice.svg', { type: 'image/svg+xml' })],
      },
    })

    const report = await screen.findByText('2 rooms and 2 user areas found in the picture.')
    expect(report.closest('[role="status"]')).toHaveTextContent(/exactly one reception/)
    expect(onImage).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/^File to check/), {
      target: { files: [new File([LIGHT_SVG], 'plain.svg', { type: 'image/svg+xml' })] },
    })
    expect(await screen.findByText(/A plain picture/)).toBeInTheDocument()
  })
})

describe('generating the dark version', () => {
  it('is offered once an SVG background is in', async () => {
    const { onImage } = step()
    expect(screen.queryByRole('button', { name: 'Generate dark version' })).toBeNull()

    upload(new File([LIGHT_SVG], 'my office.svg', { type: 'image/svg+xml' }))

    expect(await screen.findByRole('button', { name: 'Generate dark version' })).toBeTruthy()
    expect(onImage).toHaveBeenCalledWith('light', 'blob:1', 'office-light.svg')
  })

  it('is not offered for a picture, whose colours cannot be rewritten', async () => {
    const { onImage } = step()
    upload(new File(['not really a png'], 'office.png', { type: 'image/png' }))

    await waitFor(() => expect(onImage).toHaveBeenCalledWith('light', 'blob:1', 'office-light.png'))
    expect(screen.queryByRole('button', { name: 'Generate dark version' })).toBeNull()
  })

  it('fills the dark slot with a darker SVG, and offers it to keep', async () => {
    const { onImage } = step()
    upload(new File([LIGHT_SVG], 'office.svg', { type: 'image/svg+xml' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Generate dark version' }))

    const link = await screen.findByRole('link', { name: 'Download office-dark.svg' })
    expect(link.getAttribute('download')).toBe('office-dark.svg')
    expect(screen.getByRole('status').textContent).toMatch(/Dark version ready/)

    expect(onImage).toHaveBeenLastCalledWith('dark', 'blob:2', 'office-dark.svg')

    const dark = await made[1]!.text()
    expect(made[1]!.type).toBe('image/svg+xml')
    expect(dark).toContain('viewBox="0 0 2560 1440"')
    expect(dark).not.toContain('#fbf6ee')
  })

  it('forgets a dark version made from a picture that has since been replaced', async () => {
    step()
    upload(new File([LIGHT_SVG], 'office.svg', { type: 'image/svg+xml' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Generate dark version' }))
    await screen.findByRole('link', { name: /Download/ })

    upload(new File([LIGHT_SVG], 'another.svg', { type: 'image/svg+xml' }))

    await waitFor(() => expect(screen.queryByRole('link', { name: /Download/ })).toBeNull())
  })
})

describe('the name a background is saved under', () => {
  it('keeps the type it was uploaded as', () => {
    expect(backgroundFileName(new File([], 'Plan.SVG'), 'light')).toBe('office-light.svg')
    expect(backgroundFileName(new File([], 'x', { type: 'image/svg+xml' }), 'dark')).toBe(
      'office-dark.svg',
    )
    expect(backgroundFileName(new File([], 'night.WEBP'), 'dark')).toBe('office-dark.webp')
    expect(backgroundFileName(new File([], 'shot.jpeg'), 'light')).toBe('office-light.jpeg')
  })
})
