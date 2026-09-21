import { Alert, Button, Icon, Select, Toggle } from '@unityevolv/unitykit'
import { AVATAR_SIZES, MAX_ROOMS, type AvatarSize, type Template } from '@unityevolv/ofiskit-template'

import type { Selection, Tool } from '../canvas/types.js'

/**
 * What the author reaches for constantly: the two drawing tools, undo, and the
 * settings that apply to the whole template.
 *
 * Always visible and never behind a menu. Drawing a layout is a loop of draw, look,
 * adjust, and a menu in the middle of that loop is felt on every iteration.
 */

export interface UnfittedArea {
  roomId: string
  roomName: string
  areaId: string
}

export function ToolBar(props: {
  template: Template
  tool: Tool
  onTool(tool: Tool): void
  onUndo(): void
  onRedo(): void
  canUndo: boolean
  canRedo: boolean
  onAvatarSize(size: AvatarSize): void
  /** Areas that no longer fit after an avatar size change, named so they can be found. */
  unfitted: UnfittedArea[]
  onSelect(selection: Selection): void
  showGhosts: boolean
  onShowGhosts(next: boolean): void
  /** Only offered when the host supplied a dark image to preview. */
  showDark?: boolean
  onShowDark?(next: boolean): void
  onPickImage?(which: 'light' | 'dark'): void
}) {
  const { template, tool } = props

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant={tool === 'room' ? 'primary' : 'ghost'}
          onClick={() => props.onTool(tool === 'room' ? 'select' : 'room')}
          disabled={template.rooms.length >= MAX_ROOMS}
        >
          <Icon name="plus" size="sm" /> Room
        </Button>
        <Button
          size="sm"
          variant={tool === 'area' ? 'primary' : 'ghost'}
          onClick={() => props.onTool(tool === 'area' ? 'select' : 'area')}
        >
          <Icon name="plus" size="sm" /> User area
        </Button>
        <Button size="sm" variant="ghost" onClick={props.onUndo} disabled={!props.canUndo}>
          Undo
        </Button>
        <Button size="sm" variant="ghost" onClick={props.onRedo} disabled={!props.canRedo}>
          Redo
        </Button>
      </div>

      <Select
        label="Avatar size"
        help="Sets the cell size for the whole template."
        value={template.avatarSize}
        onChange={(event) => props.onAvatarSize(event.target.value as AvatarSize)}
      >
        {AVATAR_SIZES.map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
      </Select>

      {/* Rather than silently shrinking somebody's 3x2 huddle, say which areas no
          longer fit and let the author decide what to do about it. */}
      {props.unfitted.length > 0 && (
        <Alert variant="warn" title="Some user areas no longer fit">
          <ul className="mt-1 space-y-1 text-xs">
            {props.unfitted.map((entry) => (
              <li key={entry.areaId}>
                <button
                  type="button"
                  className="underline"
                  onClick={() =>
                    props.onSelect({ kind: 'area', roomId: entry.roomId, areaId: entry.areaId })
                  }
                >
                  {entry.roomName}
                </button>
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="flex flex-col gap-1">
        <Toggle
          checked={props.showGhosts}
          onChange={(event) => props.onShowGhosts(event.target.checked)}
          label="Show ghost avatars"
        />
        {props.onShowDark && (
          <Toggle
            checked={props.showDark ?? false}
            onChange={(event) => props.onShowDark?.(event.target.checked)}
            label="Preview the dark image"
          />
        )}
      </div>

      {props.onPickImage && (
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => props.onPickImage?.('light')}>
            Replace image
          </Button>
          <Button size="sm" variant="ghost" onClick={() => props.onPickImage?.('dark')}>
            Dark version
          </Button>
        </div>
      )}
    </section>
  )
}
