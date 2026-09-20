import type { PublicPresence } from '@unityevolv/ofiskit-realtime-client'
import { avatarUnit, type Room } from '@unityevolv/ofiskit-template'
import { describe, expect, it } from 'vitest'

import { placeInRoom, tokensFor } from './placement.js'

const unit = avatarUnit('landscape', 'medium')

function person(userId: string, devices = 1): PublicPresence {
  return {
    userId,
    displayName: userId,
    roomId: 'studio',
    devices: Array.from({ length: devices }, (_, index) => ({
      deviceId: `${userId}-${index}`,
      kind: index === 0 ? ('web' as const) : ('mobile' as const),
    })),
    status: 'available',
    arrivedAt: `2026-01-01T09:0${userId.length}:00.000Z`,
  }
}

/** A room with one area of the given size, positioned away from the edges. */
function roomWith(columns: number, rows: number): Room {
  return {
    id: 'studio',
    name: 'Studio',
    type: 'workspace',
    rect: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
    bar: 'top',
    areas: [{ id: 'a1', x: 0.15, y: 0.2, columns, rows }],
  }
}

const people = (count: number) => Array.from({ length: count }, (_, index) => person(`p${index}`))

describe('expanding people into avatars', () => {
  it('draws one avatar for one person on one device', () => {
    const tokens = tokensFor([person('ada')])
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({ key: 'ada', linked: false })
    expect(tokens[0]?.deviceId).toBeUndefined()
  })

  it('draws one avatar for somebody with a laptop and a phone open', () => {
    // Presence is per user. Somebody with two devices is one person standing in
    // one room, and drawing them twice would say the opposite of what the rest of
    // the product says. The device badge is how you tell they are on a phone.
    expect(tokensFor([person('ada', 2)])).toHaveLength(1)
  })

  it('draws one avatar per device when the caller says to, and links them', () => {
    // Which is what a call does: two devices in one call are two real legs in the
    // mesh, each with its own camera and microphone. Linking them is what stops
    // the pair reading as two colleagues with the same name.
    const tokens = tokensFor([person('ada', 2)], (one) => one.devices)

    expect(tokens).toHaveLength(2)
    expect(tokens.every((token) => token.linked)).toBe(true)
    expect(tokens.map((token) => token.deviceId)).toEqual(['ada-0', 'ada-1'])
    expect(new Set(tokens.map((token) => token.key)).size).toBe(2)
  })

  it('draws the plain avatar when only one device is singled out', () => {
    // One leg in a call is still just the person, so there is nothing to link to.
    const tokens = tokensFor([person('ada', 2)], (one) => one.devices.slice(0, 1))
    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.linked).toBe(false)
  })
})

describe('placing avatars in a room', () => {
  it('fills the cells the author drew, left to right then top to bottom', () => {
    const placement = placeInRoom(roomWith(3, 2), people(4), 'landscape', 'medium')

    expect(placement.placed).toHaveLength(4)
    expect(placement.overflowAt).toBeNull()
    expect(placement.placed[0]?.rect).toMatchObject({ x: 0.15, y: 0.2 })
    expect(placement.placed[1]?.rect.x).toBeCloseTo(0.15 + unit.width)
    // The fourth wraps to the second row rather than running off the side.
    expect(placement.placed[3]?.rect.y).toBeCloseTo(0.2 + unit.height)
    expect(placement.placed[3]?.rect.x).toBeCloseTo(0.15)
  })

  it('turns the last cell into a counter when there are more people than cells', () => {
    // The story's own example: four cells and twelve people shows three faces and
    // a +9, rather than shrinking everybody or spilling outside the room.
    const placement = placeInRoom(roomWith(4, 1), people(12), 'landscape', 'medium')

    expect(placement.placed).toHaveLength(3)
    expect(placement.overflow).toHaveLength(9)
    expect(placement.overflowAt).not.toBeNull()
  })

  it('uses every cell when the numbers match exactly', () => {
    const placement = placeInRoom(roomWith(2, 2), people(4), 'landscape', 'medium')
    expect(placement.placed).toHaveLength(4)
    expect(placement.overflow).toHaveLength(0)
  })

  it('counts avatars against the cells rather than people', () => {
    // User areas are display slots for what is drawn. When a caller asks for one
    // avatar per device, each of them takes a cell.
    const placement = placeInRoom(
      roomWith(2, 1),
      [person('ada', 2)],
      'landscape',
      'medium',
      (one) => one.devices,
    )
    expect(placement.placed).toHaveLength(2)
    expect(placement.overflow).toHaveLength(0)
  })

  it('draws nobody in a room nobody is in, and nobody in a room with no areas', () => {
    expect(placeInRoom(roomWith(2, 2), [], 'landscape', 'medium').placed).toHaveLength(0)

    const bare = { ...roomWith(1, 1), areas: [] }
    expect(placeInRoom(bare, people(3), 'landscape', 'medium').placed).toHaveLength(0)
  })

  it('keeps everybody inside a cell of the size the avatar setting asks for', () => {
    const large = placeInRoom(roomWith(2, 1), people(2), 'landscape', 'large')
    const small = placeInRoom(roomWith(2, 1), people(2), 'landscape', 'small')

    expect(large.cell.width).toBeGreaterThan(small.cell.width)
    expect(large.placed[0]?.rect.width).toBe(large.cell.width)
  })

  it('spreads across several areas in the order the author placed them', () => {
    const twoAreas: Room = {
      ...roomWith(1, 1),
      areas: [
        { id: 'first', x: 0.15, y: 0.2, columns: 1, rows: 1 },
        { id: 'second', x: 0.45, y: 0.45, columns: 1, rows: 1 },
      ],
    }

    const placement = placeInRoom(twoAreas, people(2), 'landscape', 'medium')
    expect(placement.placed[0]?.rect).toMatchObject({ x: 0.15, y: 0.2 })
    expect(placement.placed[1]?.rect).toMatchObject({ x: 0.45, y: 0.45 })
  })
})
