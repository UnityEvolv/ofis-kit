import { createTemplate } from '@unityevolv/ofiskit-template'
import { describe, expect, it } from 'vitest'

import {
  describeFound,
  edgeWarnings,
  fillAreas,
  firstMovedRoom,
  importOfficeFile,
} from './officeImport.js'

const marked = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" data-ofis="1" data-canvas="landscape" data-avatar="small">
  <g id="rooms">${body}</g></svg>`

const RECEPTION = `<g id="room-reception-Reception"><rect x="100" y="600" width="600" height="400"/>
  <rect id="area-4x1" x="200" y="700" width="360" height="120" fill="none"/></g>`
const CAFE = `<g id="room-break-Cafe"><rect x="1000" y="600" width="600" height="400"/></g>`

describe('what the builder makes of an uploaded SVG', () => {
  it('is a picture when nothing in it is marked', () => {
    expect(importOfficeFile('<svg viewBox="0 0 16 9"><rect/></svg>', 'x.svg')).toEqual({
      kind: 'picture',
    })
  })

  it('is an office when rooms are marked, with rule problems kept rather than refused', () => {
    const result = importOfficeFile(marked(RECEPTION + RECEPTION), 'x.svg')
    expect(result.kind).toBe('office')
    if (result.kind !== 'office') return
    expect(result.found).toEqual({ rooms: 2, areas: 2 })
    expect(result.issues.map((entry) => entry.code)).toContain('template.room_required_duplicate')
  })

  it('is refused when the file could not be shown safely, whatever else it holds', () => {
    const result = importOfficeFile(marked(RECEPTION + CAFE + '<script/>'), 'x.svg')
    expect(result.kind).toBe('refused')
    if (result.kind !== 'refused') return
    expect(result.issues[0]?.message).toContain('<script>')
  })
})

describe('a dark file against its light one', () => {
  const light = importOfficeFile(marked(RECEPTION + CAFE), 'light.svg')
  if (light.kind !== 'office') throw new Error('fixture')

  it('agrees when every room is where it was', () => {
    const dark = importOfficeFile(marked(RECEPTION + CAFE), 'dark.svg')
    if (dark.kind !== 'office') throw new Error('fixture')
    expect(firstMovedRoom(light.template, dark.template)).toBeNull()
  })

  it('names the first room that moved', () => {
    const dark = importOfficeFile(marked(RECEPTION + CAFE.replace('x="1000"', 'x="1040"')), 'd.svg')
    if (dark.kind !== 'office') throw new Error('fixture')
    expect(firstMovedRoom(light.template, dark.template)).toBe('Cafe')
  })

  it('names a room the dark file lost', () => {
    const dark = importOfficeFile(marked(RECEPTION), 'd.svg')
    if (dark.kind !== 'office') throw new Error('fixture')
    expect(firstMovedRoom(light.template, dark.template)).toBe('Cafe')
  })
})

describe('areas and edges', () => {
  it('gives a room without an area a centred one', () => {
    const office = importOfficeFile(marked(RECEPTION + CAFE), 'x.svg')
    if (office.kind !== 'office') throw new Error('fixture')
    const filled = fillAreas(office.template)
    expect(filled.rooms[0]?.areas).toHaveLength(1)
    expect(filled.rooms[1]?.areas).toHaveLength(1)
    expect(filled.rooms[1]?.areas[0]?.columns).toBe(2)
  })

  it('notes a room against the canvas edge, where a frame would cover its bar', () => {
    const template = createTemplate({ name: 't', canvas: 'landscape' })
    expect(edgeWarnings(template)).toEqual([])
    const flush = { ...template.rooms[0]!, rect: { x: 0, y: 0.3, width: 0.3, height: 0.3 } }
    expect(edgeWarnings({ ...template, rooms: [flush] })).toEqual([
      'Reception touches the edge of the canvas, where a festival frame would cover its bar.',
    ])
  })

  it('says what it found in words', () => {
    expect(describeFound({ rooms: 9, areas: 9 })).toBe(
      '9 rooms and 9 user areas found in the picture.',
    )
    expect(describeFound({ rooms: 1, areas: 0 })).toBe(
      '1 room and 0 user areas found in the picture.',
    )
  })
})
