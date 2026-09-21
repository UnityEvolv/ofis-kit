import { usableRect, type Rect, type Template } from '@unityevolv/ofiskit-template'
import { useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

import {
  MIN_DRAWN,
  addArea,
  addRoom,
  areaAt,
  clamp,
  moveArea,
  moveRoom,
  onResizeCorner,
  placeArea,
  resizeRoom,
  roomAt,
  snapRoom,
  type Unit,
} from './geometry.js'
import type { Drag, OnChange, Selection, Tool } from './types.js'

/**
 * One gesture at a time, from pointer down to pointer up.
 *
 * Held apart from the surface because it is a small state machine and the surface
 * is a large piece of markup, and mixing the two made both hard to follow. What is
 * here is only the sequencing — which gesture is running, what it looks like while
 * it runs, and when it becomes an undo step. What each gesture *means* is in
 * `geometry.ts`, where it can be tested without a pointer.
 */

export interface CanvasDrag {
  /** The rectangle being drawn, while one is. Nothing to do with the template yet. */
  preview: Rect | null
  /** Alignment guides: an edge this drag has snapped to, so the author can see it. */
  guides: { x: number[]; y: number[] }
  onPointerDown(event: ReactPointerEvent): void
  onPointerMove(event: ReactPointerEvent): void
  onPointerUp(): void
}

export function useCanvasDrag(options: {
  template: Template
  tool: Tool
  unit: Unit
  surface: RefObject<HTMLDivElement | null>
  onSelect(selection: Selection): void
  onChange: OnChange
  onToolDone(): void
}): CanvasDrag {
  const { template, tool, unit, surface, onSelect, onChange, onToolDone } = options

  const [drag, setDrag] = useState<Drag | null>(null)
  const [preview, setPreview] = useState<Rect | null>(null)
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] })

  /** Pointer position as a fraction of the canvas. */
  const pointAt = (event: ReactPointerEvent): { x: number; y: number } => {
    const rect = surface.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    }
  }

  const onPointerDown = (event: ReactPointerEvent) => {
    if (event.button !== 0) return
    const from = pointAt(event)
    event.currentTarget.setPointerCapture(event.pointerId)

    if (tool === 'room') {
      setDrag({ kind: 'draw-room', from, before: template })
      setPreview({ x: from.x, y: from.y, width: 0, height: 0 })
      return
    }

    if (tool === 'area') {
      const room = roomAt(template, from)
      if (!room) return
      setDrag({ kind: 'draw-area', roomId: room.id, from, before: template })
      setPreview({ x: from.x, y: from.y, width: 0, height: 0 })
      return
    }

    // Select: clicking an area selects it, clicking a room selects the room,
    // clicking the background clears the selection.
    const hit = areaAt(template, from)
    if (hit) {
      onSelect({ kind: 'area', roomId: hit.room.id, areaId: hit.area.id })
      setDrag({
        kind: 'move-area',
        roomId: hit.room.id,
        areaId: hit.area.id,
        from,
        before: template,
        grab: { x: from.x - hit.area.x, y: from.y - hit.area.y },
      })
      return
    }

    const room = roomAt(template, from)
    if (!room) {
      onSelect({ kind: 'none' })
      return
    }

    onSelect({ kind: 'room', roomId: room.id })

    // The bottom-right corner resizes; anywhere else moves.
    const corner = onResizeCorner(room, from)
    setDrag({
      kind: corner ? 'resize-room' : 'move-room',
      roomId: room.id,
      from,
      before: template,
      ...(corner
        ? { handle: 'se' as const }
        : { grab: { x: from.x - room.rect.x, y: from.y - room.rect.y } }),
    })
  }

  const onPointerMove = (event: ReactPointerEvent) => {
    if (!drag) return
    const at = pointAt(event)

    if (drag.kind === 'draw-room') {
      const [x, gx] = snapRoom(template, Math.min(drag.from.x, at.x), 'x')
      const [y, gy] = snapRoom(template, Math.min(drag.from.y, at.y), 'y')
      const [right] = snapRoom(template, Math.max(drag.from.x, at.x), 'x')
      const [bottom] = snapRoom(template, Math.max(drag.from.y, at.y), 'y')
      setGuides({ x: gx === null ? [] : [gx], y: gy === null ? [] : [gy] })
      setPreview({ x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) })
      return
    }

    if (drag.kind === 'draw-area' && drag.roomId) {
      const room = template.rooms.find((candidate) => candidate.id === drag.roomId)
      if (!room) return

      // Whole units on both axes, always. A fractional area is not refused here;
      // it is impossible to draw. Where it sits is the author's business.
      const columns = Math.max(1, Math.round(Math.abs(at.x - drag.from.x) / unit.width))
      const rows = Math.max(1, Math.round(Math.abs(at.y - drag.from.y) / unit.height))
      const corner = placeArea(
        { x: Math.min(drag.from.x, at.x), y: Math.min(drag.from.y, at.y) },
        { columns, rows },
        usableRect(room, template.canvas),
        unit,
      )

      setPreview({ ...corner, width: columns * unit.width, height: rows * unit.height })
      return
    }

    if (drag.kind === 'move-room' && drag.grab && drag.roomId) {
      const [x] = snapRoom(template, at.x - drag.grab.x, 'x', drag.roomId)
      const [y] = snapRoom(template, at.y - drag.grab.y, 'y', drag.roomId)
      onChange(moveRoom(template, drag.roomId, { x, y }), { transient: true })
      return
    }

    if (drag.kind === 'resize-room' && drag.roomId) {
      const [right] = snapRoom(template, at.x, 'x', drag.roomId)
      const [bottom] = snapRoom(template, at.y, 'y', drag.roomId)
      onChange(resizeRoom(template, drag.roomId, { x: right, y: bottom }, unit), {
        transient: true,
      })
      return
    }

    if (drag.kind === 'move-area' && drag.grab && drag.roomId && drag.areaId) {
      const wanted = { x: at.x - drag.grab.x, y: at.y - drag.grab.y }
      onChange(moveArea(template, drag.roomId, drag.areaId, wanted, unit), { transient: true })
    }
  }

  const onPointerUp = () => {
    if (!drag) return

    if (drag.kind === 'draw-room' && preview) {
      // A click rather than a drag: too small to be a room anybody meant.
      if (preview.width > MIN_DRAWN && preview.height > MIN_DRAWN) {
        onChange(addRoom(template, preview, unit), { before: drag.before })
      }
      onToolDone()
    }

    if (drag.kind === 'draw-area' && preview && drag.roomId) {
      onChange(addArea(template, drag.roomId, preview, unit), { before: drag.before })
      onToolDone()
    }

    if (drag.kind === 'move-room' || drag.kind === 'resize-room' || drag.kind === 'move-area') {
      // One undo step for the whole drag, not one per pointer move.
      onChange(template, { before: drag.before })
    }

    setDrag(null)
    setPreview(null)
    setGuides({ x: [], y: [] })
  }

  return { preview, guides, onPointerDown, onPointerMove, onPointerUp }
}

