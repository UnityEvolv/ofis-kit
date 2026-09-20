import {
  EPSILON,
  avatarUnit,
  barRect,
  usableRect,
  type Rect,
  type Room,
  type Template,
  type UserArea,
} from '@unityevolv/ofiskit-template'
import { useRef, useState } from 'react'

/**
 * The drawing surface.
 *
 * Two rules do most of the work here. Rooms snap to a grid and to each other's
 * edges, because freehand rectangles never line up and an office of almost
 * aligned rooms looks broken. User areas snap to whole avatar units, so a
 * fractional area is not something the author has to be told about — it is
 * something they cannot draw.
 */

export type Selection =
  | { kind: 'none' }
  | { kind: 'room'; roomId: string }
  | { kind: 'area'; roomId: string; areaId: string }

export type Tool = 'select' | 'room' | 'area'

export interface BuilderCanvasProps {
  template: Template
  /** An object URL while the author is working; a file name once saved. */
  imageUrl: string | null
  tool: Tool
  selection: Selection
  onSelect(selection: Selection): void
  onChange(template: Template, options?: { transient?: boolean; before?: Template }): void
  onToolDone(): void
  /** Draws a ghost avatar in every cell, so a full room can be judged empty. */
  showGhosts: boolean
}

/** Rooms snap to this fraction of the canvas, and to other rooms' edges. */
const GRID = 0.01
const SNAP_TO_EDGE = 0.012

interface Drag {
  kind: 'draw-room' | 'draw-area' | 'move-room' | 'resize-room' | 'move-area'
  roomId?: string
  areaId?: string
  /** Where the pointer went down, in canvas coordinates. */
  from: { x: number; y: number }
  /** The template before the drag, so the whole drag is one undo step. */
  before: Template
  /** Offset from the shape's corner, so it does not jump under the cursor. */
  grab?: { x: number; y: number }
  handle?: 'se' | 'nw'
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

export function BuilderCanvas(props: BuilderCanvasProps) {
  const { template, tool, selection } = props
  const surface = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [preview, setPreview] = useState<Rect | null>(null)
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] })

  const unit = avatarUnit(template.canvas, template.avatarSize)

  /** Pointer position as a fraction of the canvas. */
  const pointAt = (event: React.PointerEvent): { x: number; y: number } => {
    const rect = surface.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    }
  }

  /**
   * Snap a room edge to the grid, or to another room's edge if one is close.
   *
   * Edges win over the grid: lining up with the room next door is what the
   * author is actually trying to do, and the grid is only there so that a room
   * with nothing near it still lands somewhere tidy.
   */
  const snapRoom = (value: number, axis: 'x' | 'y', ignoreId?: string): [number, number | null] => {
    for (const room of template.rooms) {
      if (room.id === ignoreId) continue
      const edges =
        axis === 'x'
          ? [room.rect.x, room.rect.x + room.rect.width]
          : [room.rect.y, room.rect.y + room.rect.height]
      for (const edge of edges) {
        if (Math.abs(edge - value) < SNAP_TO_EDGE) return [edge, edge]
      }
    }
    return [Math.round(value / GRID) * GRID, null]
  }

  const onPointerDown = (event: React.PointerEvent) => {
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
      props.onSelect({ kind: 'area', roomId: hit.room.id, areaId: hit.area.id })
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
      props.onSelect({ kind: 'none' })
      return
    }

    props.onSelect({ kind: 'room', roomId: room.id })

    // The bottom-right corner resizes; anywhere else moves.
    const corner =
      Math.abs(from.x - (room.rect.x + room.rect.width)) < 0.015 &&
      Math.abs(from.y - (room.rect.y + room.rect.height)) < 0.015

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

  const onPointerMove = (event: React.PointerEvent) => {
    if (!drag) return
    const at = pointAt(event)

    if (drag.kind === 'draw-room') {
      const [x, gx] = snapRoom(Math.min(drag.from.x, at.x), 'x')
      const [y, gy] = snapRoom(Math.min(drag.from.y, at.y), 'y')
      const [right] = snapRoom(Math.max(drag.from.x, at.x), 'x')
      const [bottom] = snapRoom(Math.max(drag.from.y, at.y), 'y')
      setGuides({ x: gx === null ? [] : [gx], y: gy === null ? [] : [gy] })
      setPreview({ x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) })
      return
    }

    if (drag.kind === 'draw-area') {
      const room = template.rooms.find((candidate) => candidate.id === drag.roomId)
      if (!room) return
      const usable = usableRect(room, template.canvas)

      // Whole units on both axes, always. A fractional area is not refused
      // here; it is impossible to draw.
      const originX = usable.x
      const originY = usable.y
      const columns = Math.max(1, Math.round(Math.abs(at.x - drag.from.x) / unit.width))
      const rows = Math.max(1, Math.round(Math.abs(at.y - drag.from.y) / unit.height))
      const x =
        originX + Math.round((Math.min(drag.from.x, at.x) - originX) / unit.width) * unit.width
      const y =
        originY + Math.round((Math.min(drag.from.y, at.y) - originY) / unit.height) * unit.height

      setPreview({ x, y, width: columns * unit.width, height: rows * unit.height })
      return
    }

    if (drag.kind === 'move-room' && drag.grab) {
      const [x] = snapRoom(at.x - drag.grab.x, 'x', drag.roomId)
      const [y] = snapRoom(at.y - drag.grab.y, 'y', drag.roomId)
      props.onChange(
        mapRoom(template, drag.roomId!, (room) => ({
          ...room,
          rect: {
            ...room.rect,
            x: clamp(x, 0, 1 - room.rect.width),
            y: clamp(y, 0, 1 - room.rect.height),
          },
          // Areas belong to the room and travel with it.
          areas: room.areas.map((area) => ({
            ...area,
            x: area.x + clamp(x, 0, 1 - room.rect.width) - room.rect.x,
            y: area.y + clamp(y, 0, 1 - room.rect.height) - room.rect.y,
          })),
        })),
        { transient: true },
      )
      return
    }

    if (drag.kind === 'resize-room') {
      const [right] = snapRoom(at.x, 'x', drag.roomId)
      const [bottom] = snapRoom(at.y, 'y', drag.roomId)
      props.onChange(
        mapRoom(template, drag.roomId!, (room) => ({
          ...room,
          rect: {
            ...room.rect,
            width: clamp(right - room.rect.x, unit.width, 1 - room.rect.x),
            height: clamp(bottom - room.rect.y, unit.height, 1 - room.rect.y),
          },
        })),
        { transient: true },
      )
      return
    }

    if (drag.kind === 'move-area' && drag.grab) {
      const room = template.rooms.find((candidate) => candidate.id === drag.roomId)
      if (!room) return
      const usable = usableRect(room, template.canvas)
      const wanted = { x: at.x - drag.grab.x, y: at.y - drag.grab.y }

      props.onChange(
        mapRoom(template, room.id, (current) => ({
          ...current,
          areas: current.areas.map((area) =>
            area.id === drag.areaId
              ? {
                  ...area,
                  x: usable.x + Math.round((wanted.x - usable.x) / unit.width) * unit.width,
                  y: usable.y + Math.round((wanted.y - usable.y) / unit.height) * unit.height,
                }
              : area,
          ),
        })),
        { transient: true },
      )
    }
  }

  const onPointerUp = () => {
    if (!drag) return

    if (drag.kind === 'draw-room' && preview) {
      // A click rather than a drag: too small to be a room anybody meant.
      if (preview.width > 0.03 && preview.height > 0.03) {
        props.onChange(addRoomTo(template, preview, unit), { before: drag.before })
      }
      props.onToolDone()
    }

    if (drag.kind === 'draw-area' && preview && drag.roomId) {
      const columns = Math.max(1, Math.round(preview.width / unit.width))
      const rows = Math.max(1, Math.round(preview.height / unit.height))
      props.onChange(
        mapRoom(template, drag.roomId, (room) => ({
          ...room,
          areas: [
            ...room.areas,
            { id: `area-${Date.now().toString(36)}`, x: preview.x, y: preview.y, columns, rows },
          ],
        })),
        { before: drag.before },
      )
      props.onToolDone()
    }

    if (drag.kind === 'move-room' || drag.kind === 'resize-room' || drag.kind === 'move-area') {
      // One undo step for the whole drag, not one per pointer move.
      props.onChange(template, { before: drag.before })
    }

    setDrag(null)
    setPreview(null)
    setGuides({ x: [], y: [] })
  }

  /**
   * The keyboard half of the tool.
   *
   * A step of one grid cell, and a tenth of that with shift held down for the
   * last pixel of alignment — the same two speeds every drawing tool has, because
   * the coarse step is what somebody wants ninety times and the fine one is what
   * they want when a room is nearly right.
   *
   * A user area moves in whole avatar units, exactly as it does under a pointer:
   * a fractional area is not something the author is told about, it is something
   * they cannot make.
   */
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (selection.kind === 'none') return

    const nudges: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    }
    const direction = nudges[event.key]
    if (!direction) return
    event.preventDefault()

    const room = template.rooms.find((candidate) => candidate.id === selection.roomId)
    if (!room) return

    if (selection.kind === 'area') {
      const area = room.areas.find((candidate) => candidate.id === selection.areaId)
      if (!area) return
      const moved = {
        ...area,
        x: clamp(area.x + direction.x * unit.width, 0, 1 - area.columns * unit.width),
        y: clamp(area.y + direction.y * unit.height, 0, 1 - area.rows * unit.height),
      }
      props.onChange(
        mapRoom(template, room.id, (one) => ({
          ...one,
          areas: one.areas.map((candidate) => (candidate.id === area.id ? moved : candidate)),
        })),
      )
      return
    }

    const step = event.shiftKey ? GRID : GRID * 5

    if (event.altKey) {
      // Alt resizes rather than moves. A separate modifier from shift, so the
      // coarse and fine steps are available for resizing as well.
      props.onChange(
        mapRoom(template, room.id, (one) => ({
          ...one,
          rect: {
            ...one.rect,
            width: clamp(one.rect.width + direction.x * step, GRID * 4, 1 - one.rect.x),
            height: clamp(one.rect.height + direction.y * step, GRID * 4, 1 - one.rect.y),
          },
        })),
      )
      return
    }

    const dx = direction.x * step
    const dy = direction.y * step

    props.onChange(
      mapRoom(template, room.id, (one) => ({
        ...one,
        rect: {
          ...one.rect,
          x: clamp(one.rect.x + dx, 0, 1 - one.rect.width),
          y: clamp(one.rect.y + dy, 0, 1 - one.rect.height),
        },
        // The areas travel with the room. Leaving them behind would put every one
        // of them outside their room, which is a validation error the author did
        // not ask for.
        areas: one.areas.map((area) => ({
          ...area,
          x: clamp(area.x + dx, 0, 1),
          y: clamp(area.y + dy, 0, 1),
        })),
      })),
    )
  }

  const px = (rect: Rect) => ({
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`,
  })

  return (
    <div
      ref={surface}
      className="relative aspect-[var(--canvas-ratio)] w-full touch-none select-none overflow-hidden rounded-lg bg-base-300 ring-1 ring-base-300"
      style={
        {
          '--canvas-ratio':
            template.canvas === 'landscape'
              ? '16 / 9'
              : template.canvas === 'square'
                ? '1 / 1'
                : '3 / 4',
          cursor: tool === 'select' ? 'default' : 'crosshair',
        } as React.CSSProperties
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      /*
       * One focus stop, and the arrow keys move what is selected.
       *
       * Drawing a rectangle is a pointer gesture and there is no honest keyboard
       * equivalent of dragging one out. Adjusting one is a different matter: an
       * author who can select a room from the panel but cannot then nudge it has
       * a tool they cannot use, so the keys below are not a courtesy.
       */
      role="application"
      tabIndex={0}
      aria-label="Office layout. Select a room in the panel, then use the arrow keys to move it and shift with the arrow keys to resize it."
      data-testid="builder-canvas"
    >
      {props.imageUrl && (
        <img
          src={props.imageUrl}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full"
          draggable={false}
        />
      )}

      {template.rooms.map((room) => {
        const chosen =
          selection.kind !== 'none' && 'roomId' in selection && selection.roomId === room.id
        const bar = barRect(room.rect, room.bar, template.canvas)

        return (
          <div key={room.id}>
            <div
              className={[
                'absolute rounded-sm border-2',
                chosen
                  ? 'border-primary bg-primary/10'
                  : 'border-base-content/50 bg-base-content/5',
              ].join(' ')}
              style={px(room.rect)}
            >
              {/* The bar is drawn where it will actually be, so the author can
                  see it against the background and move it to a clearer edge. */}
              <div
                className="absolute inset-x-0 truncate bg-base-100/90 px-1 text-[10px] leading-tight text-base-content"
                style={{
                  top: room.bar === 'top' ? 0 : undefined,
                  bottom: room.bar === 'bottom' ? 0 : undefined,
                  height: `${(bar.height / room.rect.height) * 100}%`,
                }}
              >
                {room.name}
              </div>

              {chosen && (
                <span
                  className="absolute -bottom-1 -right-1 h-3 w-3 cursor-se-resize rounded-sm bg-primary"
                  aria-hidden="true"
                />
              )}
            </div>

            {room.areas.map((area) => {
              const areaChosen = selection.kind === 'area' && selection.areaId === area.id
              return (
                <div
                  key={area.id}
                  className={[
                    'absolute border border-dashed',
                    areaChosen ? 'border-primary bg-primary/20' : 'border-primary/60 bg-primary/5',
                  ].join(' ')}
                  style={px({
                    x: area.x,
                    y: area.y,
                    width: area.columns * unit.width,
                    height: area.rows * unit.height,
                  })}
                >
                  {/* Ghost avatars: the author sees how a full room looks
                      before anybody is in it. */}
                  {props.showGhosts && (
                    <div
                      className="grid h-full w-full"
                      style={{
                        gridTemplateColumns: `repeat(${area.columns}, 1fr)`,
                        gridTemplateRows: `repeat(${area.rows}, 1fr)`,
                      }}
                    >
                      {Array.from({ length: area.columns * area.rows }, (_, index) => (
                        <div
                          key={index}
                          className="flex flex-col items-center justify-center gap-[2px] p-[2px]"
                        >
                          <span className="aspect-square w-[58%] rounded-full bg-base-content/25" />
                          <span className="h-[3px] w-[70%] rounded-full bg-base-content/20" />
                        </div>
                      ))}
                    </div>
                  )}

                  <span className="absolute -top-4 left-0 rounded bg-primary px-1 text-[9px] text-primary-content">
                    {area.columns}x{area.rows}
                  </span>
                </div>
              )
            })}
          </div>
        )
      })}

      {preview && (
        <div
          className="absolute border-2 border-dashed border-primary bg-primary/10"
          style={px(preview)}
          aria-hidden="true"
        />
      )}

      {/* Alignment guides, so a room lining up with its neighbour is visible. */}
      {guides.x.map((at) => (
        <div
          key={`x${at}`}
          className="absolute inset-y-0 w-px bg-primary"
          style={{ left: `${at * 100}%` }}
          aria-hidden="true"
        />
      ))}
      {guides.y.map((at) => (
        <div
          key={`y${at}`}
          className="absolute inset-x-0 h-px bg-primary"
          style={{ top: `${at * 100}%` }}
          aria-hidden="true"
        />
      ))}
    </div>
  )
}

function roomAt(template: Template, at: { x: number; y: number }): Room | null {
  // Reverse order so the most recently added room wins where they overlap,
  // which is what the author just drew and therefore what they mean.
  for (let index = template.rooms.length - 1; index >= 0; index -= 1) {
    const room = template.rooms[index]
    if (!room) continue
    const { x, y, width, height } = room.rect
    if (at.x >= x - EPSILON && at.x <= x + width && at.y >= y - EPSILON && at.y <= y + height) {
      return room
    }
  }
  return null
}

function areaAt(
  template: Template,
  at: { x: number; y: number },
): { room: Room; area: UserArea } | null {
  const unit = avatarUnit(template.canvas, template.avatarSize)
  for (const room of template.rooms) {
    for (const area of room.areas) {
      const width = area.columns * unit.width
      const height = area.rows * unit.height
      if (at.x >= area.x && at.x <= area.x + width && at.y >= area.y && at.y <= area.y + height) {
        return { room, area }
      }
    }
  }
  return null
}

function mapRoom(template: Template, roomId: string, change: (room: Room) => Room): Template {
  return {
    ...template,
    rooms: template.rooms.map((room) => (room.id === roomId ? change(room) : room)),
  }
}

/** A new room opens with the bar at the top and one 1x1 area, ready to adjust. */
function addRoomTo(
  template: Template,
  rect: Rect,
  unit: { width: number; height: number },
): Template {
  const id = `room-${Date.now().toString(36)}`
  const used = template.rooms.filter((room) => room.type === 'workspace' || room.type === 'meeting')

  return {
    ...template,
    rooms: [
      ...template.rooms,
      {
        id,
        name: `Room ${used.length + 1}`,
        type: 'workspace',
        rect,
        bar: 'top',
        areas: [
          {
            id: `area-${Date.now().toString(36)}`,
            x: rect.x + (rect.width - unit.width) / 2,
            y: rect.y + (rect.height - unit.height) / 2,
            columns: 1,
            rows: 1,
          },
        ],
      },
    ],
  }
}
