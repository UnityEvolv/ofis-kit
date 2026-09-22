import { avatarUnit, type Template } from '@unityevolv/ofiskit-template'
import { useRef } from 'react'

import { RoomShape, percent } from './RoomShape.js'
import type { OnChange, Selection, Tool } from './types.js'
import { useCanvasDrag } from './useCanvasDrag.js'
import { useCanvasKeys } from './useCanvasKeys.js'

/**
 * The drawing surface.
 *
 * Two rules do most of the work, and both live in `geometry.ts`. Rooms snap to a
 * grid and to each other's edges, because freehand rectangles never line up and an
 * office of almost aligned rooms looks broken. User areas are *sized* in whole
 * avatar units, so a fractional area is not something the author has to be told
 * about — it is something they cannot draw.
 *
 * Sized, and not positioned: an area holding two people holds exactly two wherever
 * it sits, so its corner moves on the same fine grid as everything else.
 *
 * What is left here is the surface itself: the element, the background, the shapes
 * and the two handlers. The gestures are in `useCanvasDrag`, the keys are in
 * `useCanvasKeys`, and what any of it means to a template is in `geometry.ts`.
 */

export interface BuilderCanvasProps {
  template: Template
  /** An object URL while the author is working; a file name once saved. */
  imageUrl: string | null
  tool: Tool
  selection: Selection
  onSelect(selection: Selection): void
  onChange: OnChange
  onToolDone(): void
  /** Draws a ghost avatar in every cell, so a full room can be judged empty. */
  showGhosts: boolean
}

const RATIOS: Record<Template['canvas'], string> = {
  landscape: '16 / 9',
  square: '1 / 1',
  portrait: '3 / 4',
}

export function BuilderCanvas(props: BuilderCanvasProps) {
  const { template, tool, selection } = props
  const surface = useRef<HTMLDivElement>(null)
  const unit = avatarUnit(template.canvas, template.avatarSize)

  const drag = useCanvasDrag({
    template,
    tool,
    unit,
    surface,
    onSelect: props.onSelect,
    onChange: props.onChange,
    onToolDone: props.onToolDone,
  })

  const onKeyDown = useCanvasKeys({ template, selection, unit, onChange: props.onChange })

  return (
    <div
      ref={surface}
      className="relative aspect-[var(--canvas-ratio)] w-full touch-none select-none overflow-hidden rounded-lg bg-base-300 ring-1 ring-base-300"
      style={
        {
          '--canvas-ratio': RATIOS[template.canvas],
          cursor: tool === 'select' ? 'default' : 'crosshair',
        } as React.CSSProperties
      }
      onPointerDown={drag.onPointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerUp}
      onPointerCancel={drag.onPointerUp}
      onKeyDown={onKeyDown}
      /*
       * One focus stop, and the arrow keys move what is selected.
       *
       * Drawing a rectangle is a pointer gesture and there is no honest keyboard
       * equivalent of dragging one out. Adjusting one is a different matter: an
       * author who can select a room from the panel but cannot then nudge it has
       * a tool they cannot use, so the keys are not a courtesy.
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

      {template.rooms.map((room) => (
        <RoomShape
          key={room.id}
          room={room}
          canvas={template.canvas}
          unit={unit}
          selection={selection}
          showGhosts={props.showGhosts}
        />
      ))}

      {drag.preview && (
        <div
          className="absolute border-2 border-dashed border-primary bg-primary/10"
          style={percent(drag.preview)}
          aria-hidden="true"
        />
      )}

      {/* Alignment guides, so a room lining up with its neighbour is visible. */}
      {drag.guides.x.map((at) => (
        <div
          key={`x${at}`}
          className="absolute inset-y-0 w-px bg-primary"
          style={{ left: `${at * 100}%` }}
          aria-hidden="true"
        />
      ))}
      {drag.guides.y.map((at) => (
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
