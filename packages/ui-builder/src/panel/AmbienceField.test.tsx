import { createTemplate, type Template } from '@unityevolv/ofiskit-template'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OfficeBuilder } from '../OfficeBuilder.js'

/**
 * Ambience in the builder: an office default, a choice per room, and a preview
 * so the author hears a loop before everybody else does.
 */

const library = [
  { id: 'cafe', label: 'Café', src: '/ambience/cafe.mp3' },
  { id: 'rain', label: 'Rain', src: '/ambience/rain.mp3' },
]

const played: Array<{ src: string; volume: number; loop: boolean; paused: boolean }> = []

beforeEach(() => {
  played.length = 0
  vi.stubGlobal(
    'Audio',
    class {
      src: string
      volume = 1
      loop = false
      paused = true
      constructor(src: string) {
        this.src = src
        played.push(this)
      }
      play() {
        this.paused = false
        return Promise.resolve()
      }
      pause() {
        this.paused = true
      }
    },
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function open(overrides: Partial<Template> = {}, withLibrary = true) {
  const onSave = vi.fn()
  const template = {
    ...createTemplate({ name: 'My office', canvas: 'landscape', images: { light: 'o.webp' } }),
    ...overrides,
  }
  render(
    <OfficeBuilder
      template={template}
      imageUrl={null}
      saveLabel="Download template.json"
      onSave={onSave}
      {...(withLibrary ? { ambienceLibrary: library } : {})}
    />,
  )
  return { onSave, template }
}

async function selectRoom(person: ReturnType<typeof userEvent.setup>, name: RegExp) {
  const rooms = screen.getByRole('list', { name: 'Rooms' })
  await person.click(within(rooms).getByRole('button', { name }))
}

async function save(person: ReturnType<typeof userEvent.setup>, onSave: ReturnType<typeof vi.fn>) {
  await person.click(screen.getByRole('button', { name: /download template\.json/i }))
  return onSave.mock.calls.at(-1)?.[0] as Template
}

describe('ambience in the builder', () => {
  it('starts silent: no office default and no room choices', async () => {
    const person = userEvent.setup()
    const { onSave } = open()
    expect(screen.getByRole('combobox', { name: /office ambience/i })).toHaveValue('none')
    const saved = await save(person, onSave)
    expect(saved).not.toHaveProperty('ambience')
    for (const room of saved.rooms) expect(room).not.toHaveProperty('ambience')
  })

  it('sets the office default once for every room', async () => {
    const person = userEvent.setup()
    const { onSave } = open()
    await person.selectOptions(screen.getByRole('combobox', { name: /office ambience/i }), 'cafe')
    const saved = await save(person, onSave)
    expect(saved.ambience).toBe('cafe')
  })

  it('lets a room override the default, or have none', async () => {
    const person = userEvent.setup()
    const { onSave } = open({ ambience: 'cafe' })

    await selectRoom(person, /break/i)
    const field = screen.getByRole('combobox', { name: /^ambience/i })
    // What following the office means is said in the option itself.
    expect(within(field).getByRole('option', { name: 'Same as the office (Café)' })).toBeVisible()
    await person.selectOptions(field, 'rain')

    let saved = await save(person, onSave)
    expect(saved.rooms.find((room) => room.type === 'break')?.ambience).toBe('rain')

    await person.selectOptions(screen.getByRole('combobox', { name: /^ambience/i }), 'none')
    saved = await save(person, onSave)
    expect(saved.rooms.find((room) => room.type === 'break')?.ambience).toBe('none')

    await person.selectOptions(screen.getByRole('combobox', { name: /^ambience/i }), '')
    saved = await save(person, onSave)
    expect(saved.rooms.find((room) => room.type === 'break')).not.toHaveProperty('ambience')
  })

  it('previews a loop quietly, and stops it on a second press', async () => {
    const person = userEvent.setup()
    open()
    await person.selectOptions(screen.getByRole('combobox', { name: /office ambience/i }), 'rain')
    await person.click(screen.getByRole('button', { name: 'Preview Rain' }))
    expect(played).toHaveLength(1)
    expect(played[0]).toMatchObject({ src: '/ambience/rain.mp3', loop: true, paused: false })
    expect(played[0]?.volume).toBeLessThan(1)

    await person.click(screen.getByRole('button', { name: 'Stop preview of Rain' }))
    expect(played[0]?.paused).toBe(true)
  })

  it('stops a preview when the choice changes', async () => {
    const person = userEvent.setup()
    open({ ambience: 'cafe' })
    await person.click(screen.getByRole('button', { name: 'Preview Café' }))
    await person.selectOptions(screen.getByRole('combobox', { name: /office ambience/i }), 'rain')
    expect(played[0]?.paused).toBe(true)
  })

  it('says where ambience suits a room badly, without refusing it', async () => {
    const person = userEvent.setup()
    const { onSave } = open({ ambience: 'cafe' })
    await selectRoom(person, /workspace/i)
    await person.selectOptions(screen.getByRole('combobox', { name: /^type/i }), 'meeting')
    expect(screen.getByText(/get in the way where people meet/i)).toBeInTheDocument()
    expect((await save(person, onSave)).ambience).toBe('cafe')
  })

  it('keeps a choice this host’s library does not have, rather than replacing it', async () => {
    const person = userEvent.setup()
    const { onSave } = open({ ambience: 'harbour' })
    expect(
      within(screen.getByRole('combobox', { name: /office ambience/i })).getByRole('option', {
        name: 'harbour (not in this library)',
      }),
    ).toBeInTheDocument()
    expect((await save(person, onSave)).ambience).toBe('harbour')
  })

  it('offers no ambience controls to a host without loops', () => {
    open({}, false)
    expect(screen.queryByRole('combobox', { name: /ambience/i })).not.toBeInTheDocument()
  })
})
