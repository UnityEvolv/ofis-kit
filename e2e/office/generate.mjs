/**
 * The office the end-to-end tests run in: the background images and
 * template.json, generated together from one description.
 *
 * The tests have an office of their own rather than using the one in config/,
 * because they walk into rooms by name. The office that ships is meant to be
 * replaced, and replacing it should never break the tests.
 *
 * Generated rather than hand-drawn for one reason: the image and the geometry
 * have to agree. A floor plan drawn by hand and a template written by hand
 * drift within a day, and the symptom is avatars standing on walls. Here the
 * rooms are described once, the picture is drawn from that description, and the
 * template is written from the same description.
 *
 * It is also the clearest demonstration of the rules in the background prompt:
 * no text anywhere, seats drawn, nothing tall on a desk, plain floors in the
 * middle of each area, detail at the edges.
 *
 *   node e2e/office/generate.mjs
 *
 * The tests name its rooms (Studio, Reception and the rest), so a change to
 * the description here is a change to the tests.
 */
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { barRect, centredArea, usableRect } from '@unityevolv/ofiskit-template'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))

const CANVAS = { shape: 'landscape', width: 2560, height: 1440 }
const AVATAR_SIZE = 'medium'

/**
 * The office, once.
 *
 * `seats` says how the furniture is arranged, so the picture shows a place
 * somebody would sit wherever the template puts an avatar cell.
 */
const ROOMS = [
  { id: 'reception', name: 'Reception', type: 'reception', rect: { x: 0.04, y: 0.6, width: 0.28, height: 0.32 }, bar: 'top', cells: [2, 1], seats: 'lounge' },
  { id: 'break', name: 'Break room', type: 'break', rect: { x: 0.68, y: 0.6, width: 0.28, height: 0.32 }, bar: 'top', cells: [3, 1], seats: 'lounge' },
  { id: 'studio', name: 'Studio', type: 'workspace', rect: { x: 0.04, y: 0.1, width: 0.28, height: 0.38 }, bar: 'top', cells: [3, 2], seats: 'desks' },
  { id: 'north', name: 'North meeting', type: 'meeting', rect: { x: 0.36, y: 0.1, width: 0.26, height: 0.3 }, bar: 'bottom', cells: [2, 1], seats: 'table' },
  { id: 'east', name: 'East meeting', type: 'meeting', rect: { x: 0.66, y: 0.1, width: 0.3, height: 0.3 }, bar: 'bottom', cells: [3, 1], seats: 'table' },
  { id: 'huddle', name: 'Huddle', type: 'workspace', rect: { x: 0.36, y: 0.52, width: 0.26, height: 0.4 }, bar: 'top', cells: [2, 2], seats: 'desks' },
]

/**
 * Two palettes for the same scene.
 *
 * The dark image is a recolouring, never a different layout: both share one set
 * of room coordinates, and the builder enforces that by having one geometry with
 * two image slots.
 */
const PALETTES = {
  light: {
    floor: '#EFEAE3',
    slab: '#E3DCD2',
    wall: '#CFC5B8',
    rug: '#D9CFC2',
    wood: '#C4A986',
    seat: '#A8B5AE',
    accent: '#8FB3B8',
    plant: '#8FA98B',
  },
  dark: {
    floor: '#23222A',
    slab: '#2B2933',
    wall: '#3A3743',
    rug: '#302E3A',
    wood: '#4A3F36',
    seat: '#3F4A4B',
    accent: '#3C5A61',
    plant: '#3B5142',
  },
}

const px = (rect) => ({
  x: rect.x * CANVAS.width,
  y: rect.y * CANVAS.height,
  width: rect.width * CANVAS.width,
  height: rect.height * CANVAS.height,
})

/** A desk with chairs at it, drawn flat and low so an avatar can sit on top. */
function desks(area, colour) {
  const parts = []
  const columns = 2
  const rows = 2
  const deskWidth = area.width / columns
  const deskHeight = area.height / rows

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = area.x + column * deskWidth + deskWidth * 0.12
      const y = area.y + row * deskHeight + deskHeight * 0.2
      const width = deskWidth * 0.76
      const height = deskHeight * 0.34
      parts.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="10" fill="${colour.wood}"/>`)
      // Chairs, as simple discs: a seat read from directly above.
      parts.push(
        `<circle cx="${x + width * 0.3}" cy="${y + height + deskHeight * 0.16}" r="${Math.min(width, height) * 0.22}" fill="${colour.seat}"/>`,
        `<circle cx="${x + width * 0.7}" cy="${y + height + deskHeight * 0.16}" r="${Math.min(width, height) * 0.22}" fill="${colour.seat}"/>`,
      )
    }
  }
  return parts.join('')
}

/** One long table with chairs down both sides. */
function table(area, colour) {
  const width = area.width * 0.62
  const height = area.height * 0.3
  const x = area.x + (area.width - width) / 2
  const y = area.y + (area.height - height) / 2
  const parts = [`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="14" fill="${colour.wood}"/>`]

  const seats = 4
  for (let index = 0; index < seats; index += 1) {
    const cx = x + (width / (seats + 1)) * (index + 1)
    parts.push(
      `<circle cx="${cx}" cy="${y - height * 0.45}" r="${height * 0.3}" fill="${colour.seat}"/>`,
      `<circle cx="${cx}" cy="${y + height + height * 0.45}" r="${height * 0.3}" fill="${colour.seat}"/>`,
    )
  }
  return parts.join('')
}

/** A sofa and a low table, for reception and the break room. */
function lounge(area, colour) {
  const width = area.width * 0.5
  const height = area.height * 0.22
  const x = area.x + area.width * 0.06
  const y = area.y + area.height * 0.55

  return [
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height * 0.45}" fill="${colour.seat}"/>`,
    `<rect x="${x + width * 0.2}" y="${y - height * 1.5}" width="${width * 0.6}" height="${height * 0.9}" rx="12" fill="${colour.wood}"/>`,
    `<circle cx="${area.x + area.width * 0.82}" cy="${area.y + area.height * 0.7}" r="${height * 0.5}" fill="${colour.plant}"/>`,
  ].join('')
}

function draw(theme, template) {
  const colour = PALETTES[theme]
  const parts = [
    `<rect width="${CANVAS.width}" height="${CANVAS.height}" fill="${colour.slab}"/>`,
  ]

  for (const room of template.rooms) {
    const described = ROOMS.find((candidate) => candidate.name === room.name)
    const box = px(room.rect)

    // The floor, with a wall line around it, so areas read as separate places.
    parts.push(
      `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="18" fill="${colour.floor}" stroke="${colour.wall}" stroke-width="6"/>`,
    )

    // A rug marks where people gather, and gives the middle of the room some
    // colour without putting anything on it.
    const usable = px(usableRect(room, template.canvas))
    parts.push(
      `<rect x="${usable.x + usable.width * 0.08}" y="${usable.y + usable.height * 0.08}" width="${usable.width * 0.84}" height="${usable.height * 0.84}" rx="16" fill="${colour.rug}"/>`,
    )

    const furniture = { desks, table, lounge }[described?.seats ?? 'desks']
    parts.push(furniture(usable, colour))

    // Detail at the edges rather than in the middle: a plant in a corner never
    // sits under an avatar.
    parts.push(
      `<circle cx="${box.x + box.width - 40}" cy="${box.y + box.height - 40}" r="22" fill="${colour.plant}"/>`,
    )

    // A faint strip where the room bar will be drawn, so the picture leaves
    // room for it rather than fighting it.
    const bar = px(barRect(room.rect, room.bar, template.canvas))
    parts.push(
      `<rect x="${bar.x}" y="${bar.y}" width="${bar.width}" height="${bar.height}" fill="${colour.accent}" opacity="0.18"/>`,
    )
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS.width}" height="${CANVAS.height}" viewBox="0 0 ${CANVAS.width} ${CANVAS.height}">${parts.join('')}</svg>`
}

/** Build the template first; the picture is drawn from it, never the other way. */
function buildTemplate() {
  const rooms = ROOMS.map((described) => {
    const room = {
      id: described.id,
      name: described.name,
      type: described.type,
      rect: described.rect,
      bar: described.bar,
      areas: [],
    }
    room.areas = [
      centredArea(room, CANVAS.shape, AVATAR_SIZE, described.cells[0], described.cells[1], `${described.id}-area`),
    ]
    return room
  })

  return {
    version: 1,
    name: 'Modern office',
    description: 'The office ofiskit ships with. Replace these two files to replace the office.',
    canvas: CANVAS.shape,
    avatarSize: AVATAR_SIZE,
    images: { light: 'office-light.webp', dark: 'office-dark.webp' },
    rooms,
  }
}

const template = buildTemplate()

for (const theme of ['light', 'dark']) {
  const svg = draw(theme, template)
  await sharp(Buffer.from(svg)).webp({ quality: 88 }).toFile(join(here, `office-${theme}.webp`))
}

await writeFile(join(here, 'template.json'), `${JSON.stringify(template, null, 2)}\n`)

console.log(`Wrote template.json and two ${CANVAS.width}x${CANVAS.height} backgrounds for ${template.rooms.length} rooms.`)
