import type { Template } from '@unityevolv/ofiskit-template'

/**
 * What the canvas is for and what is picked, shared by the surface and the panel.
 *
 * In their own file because the hooks, the surface and the panel all need them,
 * and a type imported from the component that renders it is how two files end up
 * importing each other.
 */

export type Tool = 'select' | 'room' | 'area'

export type Selection =
  | { kind: 'none' }
  | { kind: 'room'; roomId: string }
  | { kind: 'area'; roomId: string; areaId: string }

/** How a change reaches the history: replacing a step, or opening a new one. */
export interface ChangeOptions {
  /** Part of a drag in progress. Replaces the current step rather than adding one. */
  transient?: boolean
  /** The template as it was before this gesture, which is what undo goes back to. */
  before?: Template
}

export type OnChange = (template: Template, options?: ChangeOptions) => void

/** One gesture in progress. */
export interface Drag {
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
