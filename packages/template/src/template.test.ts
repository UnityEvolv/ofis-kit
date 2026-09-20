import { describe, expect, it } from 'vitest'

import { addRoom, createTemplate, withAvatarSize } from './create.js'
import { TemplateError } from './errors.js'
import { avatarUnit, canvasPixels, minRoomSize } from './geometry.js'
import { isId, newId } from './id.js'
import { AVATAR_SIZES, CANVAS_SHAPES, MAX_ROOMS, type AvatarSize, type CanvasShape } from './types.js'
import { parseTemplate, validateTemplate } from './validate.js'

/** A seeded template with an image, which is what a server would be handed. */
function seeded(canvas: CanvasShape = 'landscape', avatarSize: AvatarSize = 'medium') {
  return createTemplate({
    name: 'Test office',
    canvas,
    avatarSize,
    images: { light: 'office-light.webp' },
  })
}

/** The codes reported, for asserting on a refusal without pinning the wording. */
function codes(input: unknown): string[] {
  const result = validateTemplate(input)
  return result.ok ? [] : result.issues.map((issue) => issue.code)
}

describe('a new template', () => {
  it('arrives with its three rooms already placed, on every shape', () => {
    for (const canvas of CANVAS_SHAPES) {
      const template = seeded(canvas)
      const types = template.rooms.map((room) => room.type).sort()
      expect(types, canvas).toEqual(['break', 'reception', 'workspace'])
    }
  })

  it('is valid on every combination of shape and avatar size', () => {
    // The seed layout is the one piece of geometry nobody chose deliberately for
    // each case, so it is the one most likely to be quietly wrong. A new
    // template that fails its own validator would be a poor first impression.
    for (const canvas of CANVAS_SHAPES) {
      for (const avatarSize of AVATAR_SIZES) {
        const result = validateTemplate(seeded(canvas, avatarSize))
        expect(result.ok ? [] : result.issues, `${canvas}/${avatarSize}`).toEqual([])
      }
    }
  })

  it('gives every room a bar position and one 2x1 user area', () => {
    for (const room of seeded().rooms) {
      expect(room.bar).toBe('top')
      expect(room.areas).toHaveLength(1)
      expect(room.areas[0]).toMatchObject({ columns: 2, rows: 1 })
    }
  })

  it('refuses a template with no reception, and one with two', () => {
    const template = seeded()
    const withoutReception = {
      ...template,
      rooms: template.rooms.filter((room) => room.type !== 'reception'),
    }
    expect(codes(withoutReception)).toContain(TemplateError.ROOM_REQUIRED_MISSING)

    const reception = template.rooms.find((room) => room.type === 'reception')
    const twice = {
      ...template,
      rooms: [...template.rooms, { ...reception, id: newId(), name: 'Front desk' }],
    }
    expect(codes(twice)).toContain(TemplateError.ROOM_REQUIRED_DUPLICATE)
  })
})

describe('room names', () => {
  it('must be unique, ignoring case and surrounding space', () => {
    const template = seeded()
    const [first, second] = template.rooms
    const clashing = {
      ...template,
      rooms: template.rooms.map((room) =>
        room.id === second?.id ? { ...room, name: ` ${first?.name.toUpperCase()} ` } : room,
      ),
    }
    expect(codes(clashing)).toContain(TemplateError.ROOM_NAME_DUPLICATE)
  })

  it('cannot be blank', () => {
    const template = seeded()
    const blank = {
      ...template,
      rooms: template.rooms.map((room, index) => (index === 0 ? { ...room, name: '   ' } : room)),
    }
    expect(codes(blank)).toContain(TemplateError.ROOM_NAME_EMPTY)
  })
})

describe('geometry', () => {
  it('refuses overlapping rooms', () => {
    const template = seeded()
    const [first, second] = template.rooms
    const overlapping = {
      ...template,
      rooms: template.rooms.map((room) =>
        room.id === second?.id ? { ...room, rect: { ...first!.rect } } : room,
      ),
    }
    expect(codes(overlapping)).toContain(TemplateError.ROOM_OVERLAP)
  })

  it('refuses a room that runs off the canvas', () => {
    const template = seeded()
    const spilling = {
      ...template,
      rooms: template.rooms.map((room, index) =>
        index === 0 ? { ...room, rect: { ...room.rect, x: 0.9 } } : room,
      ),
    }
    expect(codes(spilling)).toContain(TemplateError.ROOM_OUTSIDE_CANVAS)
  })

  it('enforces a minimum that differs per shape and per avatar size', () => {
    // The same room is legal on a landscape canvas and too small on a portrait
    // one, because the minimum is pixels at the reference viewport and a
    // portrait canvas is narrower. This is the rule most likely to be
    // implemented as one fixed percentage, which would be wrong.
    const landscape = minRoomSize('landscape', 'medium')
    const portrait = minRoomSize('portrait', 'medium')
    expect(portrait.width).toBeGreaterThan(landscape.width)

    const large = minRoomSize('landscape', 'large')
    const small = minRoomSize('landscape', 'small')
    expect(large.height).toBeGreaterThan(small.height)
  })

  it('refuses a room below the minimum, with the minimum in the error', () => {
    const template = seeded('landscape', 'large')
    const minimum = minRoomSize('landscape', 'large')
    const tiny = {
      ...template,
      rooms: template.rooms.map((room, index) =>
        index === 0
          ? { ...room, rect: { ...room.rect, width: minimum.width / 2, height: minimum.height / 2 }, areas: [] }
          : room,
      ),
    }
    const result = validateTemplate(tiny)
    expect(result.ok).toBe(false)
    if (result.ok) return

    const tooSmall = result.issues.find((issue) => issue.code === TemplateError.ROOM_TOO_SMALL)
    expect(tooSmall).toBeDefined()
    // The author is told what the minimum actually is, so "make it bigger" is
    // actionable rather than a guessing game.
    expect(tooSmall?.fields?.minWidth).toBe(minimum.width.toFixed(4))
    expect(tooSmall?.message).toContain('large')
  })

  it('refuses more than thirty rooms', () => {
    let template = seeded()
    // Stacked off in a corner: this test is about the count, and the other
    // geometry rules have their own tests.
    for (let index = template.rooms.length; index <= MAX_ROOMS; index += 1) {
      template = addRoom(template, 'workspace', { x: 0.01, y: 0.01, width: 0.2, height: 0.3 }, `Room ${index}`)
    }
    expect(template.rooms.length).toBeGreaterThan(MAX_ROOMS)
    expect(codes(template)).toContain(TemplateError.ROOMS_TOO_MANY)
  })
})

describe('user areas', () => {
  it('refuses a fractional cell count', () => {
    const template = seeded()
    const fractional = {
      ...template,
      rooms: template.rooms.map((room, index) =>
        index === 0
          ? { ...room, areas: [{ ...room.areas[0]!, columns: 2.5 }] }
          : room,
      ),
    }
    expect(codes(fractional)).toContain(TemplateError.AREA_FRACTIONAL)
  })

  it('refuses zero or negative cells', () => {
    const template = seeded()
    const empty = {
      ...template,
      rooms: template.rooms.map((room, index) =>
        index === 0 ? { ...room, areas: [{ ...room.areas[0]!, rows: 0 }] } : room,
      ),
    }
    expect(codes(empty)).toContain(TemplateError.AREA_FRACTIONAL)
  })

  it('refuses an area that leaves its room', () => {
    const template = seeded()
    const outside = {
      ...template,
      rooms: template.rooms.map((room, index) =>
        index === 0 ? { ...room, areas: [{ ...room.areas[0]!, x: room.rect.x + room.rect.width }] } : room,
      ),
    }
    expect(codes(outside)).toContain(TemplateError.AREA_OUTSIDE_ROOM)
  })

  it('refuses an area under the control bar', () => {
    const template = seeded()
    const underBar = {
      ...template,
      rooms: template.rooms.map((room, index) =>
        index === 0 ? { ...room, bar: 'top' as const, areas: [{ ...room.areas[0]!, y: room.rect.y }] } : room,
      ),
    }
    expect(codes(underBar)).toContain(TemplateError.AREA_OVERLAPS_BAR)
  })

  it('refuses two areas that overlap each other', () => {
    const template = seeded()
    const stacked = {
      ...template,
      rooms: template.rooms.map((room, index) =>
        index === 1
          ? { ...room, areas: [room.areas[0]!, { ...room.areas[0]!, id: newId() }] }
          : room,
      ),
    }
    expect(codes(stacked)).toContain(TemplateError.AREA_OVERLAP)
  })
})

describe('avatar size', () => {
  it('rescales every area when it changes, keeping the cell counts', () => {
    const template = seeded('landscape', 'small')
    const before = avatarUnit('landscape', 'small')
    const { template: bigger, unfitted } = withAvatarSize(template, 'large')
    const after = avatarUnit('landscape', 'large')

    expect(after.width).toBeGreaterThan(before.width)
    expect(unfitted).toEqual([])

    // The cell counts are the author's intent and survive; what changes is how
    // much of the canvas a cell takes, which is derived and never stored.
    for (const [index, room] of bigger.rooms.entries()) {
      expect(room.areas[0]?.columns).toBe(template.rooms[index]?.areas[0]?.columns)
      expect(room.areas[0]?.rows).toBe(template.rooms[index]?.areas[0]?.rows)
    }

    expect(validateTemplate(bigger).ok).toBe(true)
  })

  it('reports the areas that no longer fit, rather than shrinking them', () => {
    const template = seeded('portrait', 'small')
    // A wide area that only fits while the cells are small.
    const wide = {
      ...template,
      rooms: template.rooms.map((room, index) =>
        index === 0 ? { ...room, areas: [{ ...room.areas[0]!, columns: 5 }] } : room,
      ),
    }
    const { unfitted } = withAvatarSize(wide, 'large')
    expect(unfitted).toHaveLength(1)
    // It says what would fit, so the builder can offer a one-click repair.
    expect(unfitted[0]?.fits.columns).toBeGreaterThanOrEqual(1)
    expect(unfitted[0]?.roomName).toBe(wide.rooms[0]?.name)
  })
})

describe('images', () => {
  it('requires a light image and accepts a dark one beside it', () => {
    const template = seeded()
    const themed = { ...template, images: { light: 'day.webp', dark: 'night.webp' } }
    const result = validateTemplate(themed)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.images.dark).toBe('night.webp')
  })

  it('refuses a template with no light image', () => {
    const template = seeded()
    expect(codes({ ...template, images: {} })).toContain(TemplateError.IMAGE_MISSING)
  })
})

describe('template.json from the open-source app', () => {
  it('round-trips through JSON unchanged', () => {
    // The promise the whole boundary rests on: a template built in the free
    // builder imports into unityofis without a migration or an edit.
    const template = createTemplate({
      name: 'Hilltop',
      canvas: 'square',
      avatarSize: 'large',
      description: 'Pavilions on a hill',
      images: { light: 'hill-light.webp', dark: 'hill-dark.webp' },
    })

    const result = parseTemplate(JSON.stringify(template, null, 2))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual(template)
  })

  it('reports a file that is not JSON as a bad file, not as thirty missing fields', () => {
    const result = parseTemplate('{ not json')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]?.code).toBe(TemplateError.MALFORMED)
  })

  it('refuses an unknown canvas shape and an unknown avatar size', () => {
    const template = seeded()
    expect(codes({ ...template, canvas: 'ultrawide' })).toContain(TemplateError.CANVAS_UNKNOWN)
    expect(codes({ ...template, avatarSize: 'enormous' })).toContain(TemplateError.AVATAR_SIZE_UNKNOWN)
  })
})

describe('canvas maths', () => {
  it('letterboxes each shape into the reference tablet viewport', () => {
    expect(canvasPixels('landscape')).toEqual({ width: 1024, height: 576 })
    expect(canvasPixels('square')).toEqual({ width: 768, height: 768 })
    expect(canvasPixels('portrait')).toEqual({ width: 576, height: 768 })
  })
})

describe('ids', () => {
  it('are UUIDv7 and sort by the moment they were made', () => {
    const early = newId(1_700_000_000_000)
    const late = newId(1_700_000_001_000)
    expect(isId(early)).toBe(true)
    expect(early < late).toBe(true)
  })

  it('still sort when minted in the same millisecond', () => {
    const at = 1_700_000_000_000
    const ids = Array.from({ length: 50 }, () => newId(at))
    expect([...ids].sort()).toEqual(ids)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
