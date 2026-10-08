import { describe, expect, it } from 'vitest'

import { AMBIENCE_NONE, isAmbienceId, roomAmbience, roomTrack } from './ambience.js'
import { createTemplate } from './create.js'
import { TemplateError } from './errors.js'
import type { Template } from './types.js'
import { validateTemplate } from './validate.js'

function seeded(): Template {
  return createTemplate({
    name: 'Test office',
    canvas: 'landscape',
    avatarSize: 'medium',
    images: { light: 'office-light.webp' },
  })
}

function withRoomAmbience(template: Template, type: string, ambience: unknown): unknown {
  return {
    ...template,
    rooms: template.rooms.map((room) => (room.type === type ? { ...room, ambience } : room)),
  }
}

describe('an ambience id', () => {
  it('is lower-case words joined by single hyphens', () => {
    for (const good of ['cafe', 'soft-rain', 'room-2']) expect(isAmbienceId(good), good).toBe(true)
    for (const bad of ['', 'Cafe', 'soft rain', 'soft--rain', '-rain', 'rain-', 'café', 42, null]) {
      expect(isAmbienceId(bad), String(bad)).toBe(false)
    }
  })

  it('is never "none", which means silence', () => {
    expect(isAmbienceId(AMBIENCE_NONE)).toBe(false)
  })

  it('is at most forty characters', () => {
    expect(isAmbienceId('a'.repeat(40))).toBe(true)
    expect(isAmbienceId('a'.repeat(41))).toBe(false)
  })
})

describe('the loop a room plays', () => {
  const template = seeded()
  const [room] = template.rooms
  if (!room) throw new Error('A seeded template has rooms.')

  it('is silence when nobody chose anything', () => {
    expect(roomAmbience(template, room)).toBeNull()
  })

  it('is the office default when the room does not choose', () => {
    expect(roomAmbience({ ambience: 'cafe' }, room)).toBe('cafe')
  })

  it('is the room’s own choice over the default', () => {
    expect(roomAmbience({ ambience: 'cafe' }, { ...room, ambience: 'rain' })).toBe('rain')
  })

  it('is silence when the room says none, whatever the default', () => {
    expect(roomAmbience({ ambience: 'cafe' }, { ...room, ambience: AMBIENCE_NONE })).toBeNull()
  })

  it('is found in the library by id, and is nothing when the library lacks it', () => {
    const library = [{ id: 'cafe', label: 'Café', src: '/ambience/cafe.mp3' }]
    expect(roomTrack({ ambience: 'cafe' }, room, library)).toEqual(library[0])
    expect(roomTrack({ ambience: 'harbour' }, room, library)).toBeNull()
    expect(roomTrack({}, room, library)).toBeNull()
  })
})

describe('validating ambience', () => {
  it('keeps a template default and room choices', () => {
    const input = withRoomAmbience({ ...seeded(), ambience: 'cafe' }, 'break', 'rain')
    const result = validateTemplate(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.ambience).toBe('cafe')
    expect(result.value.rooms.find((room) => room.type === 'break')?.ambience).toBe('rain')
    expect(result.value.rooms.find((room) => room.type === 'reception')).not.toHaveProperty(
      'ambience',
    )
  })

  it('keeps "none" on a room', () => {
    const result = validateTemplate(withRoomAmbience(seeded(), 'workspace', AMBIENCE_NONE))
    expect(
      result.ok && result.value.rooms.find((room) => room.type === 'workspace')?.ambience,
    ).toBe(AMBIENCE_NONE)
  })

  it('adds nothing to a template that never mentioned it', () => {
    const result = validateTemplate(seeded())
    expect(result.ok && result.value).not.toHaveProperty('ambience')
  })

  it('refuses a malformed room ambience and says where', () => {
    const result = validateTemplate(withRoomAmbience(seeded(), 'break', 'Café Hum'))
    expect(result.ok).toBe(false)
    if (result.ok) return
    const found = result.issues.find((one) => one.code === TemplateError.AMBIENCE_INVALID)
    expect(found?.path).toMatch(/^rooms\[\d+\]\.ambience$/)
  })

  it('refuses "none" and malformed ids as the office default', () => {
    for (const ambience of [AMBIENCE_NONE, 'Rain', 7]) {
      const result = validateTemplate({ ...seeded(), ambience })
      expect(result.ok, String(ambience)).toBe(false)
      if (!result.ok) {
        expect(result.issues.map((one) => [one.code, one.path])).toContainEqual([
          TemplateError.AMBIENCE_INVALID,
          'ambience',
        ])
      }
    }
  })
})
