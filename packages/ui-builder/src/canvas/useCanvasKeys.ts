import type { Template } from '@unityevolv/ofiskit-template'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

import { GRID, nudgeArea, nudgeRoom, type Direction, type Unit } from './geometry.js'
import type { OnChange, Selection } from './types.js'

/**
 * The keyboard half of the tool.
 *
 * A step of five grid cells, and one cell with shift held down for the last pixel
 * of alignment — the same two speeds every drawing tool has, because the coarse
 * step is what somebody wants ninety times and the fine one is what they want when
 * a room is nearly right. Alt resizes instead of moving.
 *
 * Not a courtesy. Drawing a rectangle is a pointer gesture with no honest keyboard
 * equivalent, but adjusting one is a different matter: an author who can select a
 * room in the panel and then cannot move it has a tool they cannot use.
 *
 * A user area moves the same way under the keyboard as under a pointer — on the
 * grid rather than on the avatar lattice, and never out of the room it belongs to.
 */

const NUDGES: Record<string, Direction> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
}

export function useCanvasKeys(options: {
  template: Template
  selection: Selection
  unit: Unit
  onChange: OnChange
}): (event: ReactKeyboardEvent) => void {
  const { template, selection, unit, onChange } = options

  return (event: ReactKeyboardEvent) => {
    if (selection.kind === 'none') return

    const direction = NUDGES[event.key]
    if (!direction) return
    event.preventDefault()

    const room = template.rooms.find((candidate) => candidate.id === selection.roomId)
    if (!room) return

    const step = event.shiftKey ? GRID : GRID * 5

    if (selection.kind === 'area') {
      onChange(nudgeArea(template, room.id, selection.areaId, direction, step, unit))
      return
    }

    onChange(nudgeRoom(template, room.id, direction, step, { resize: event.altKey }))
  }
}
