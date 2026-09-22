import {
  validateTemplate,
  withAvatarSize,
  type AvatarSize,
  type Template,
  type TemplateIssue,
} from '@unityevolv/ofiskit-template'
import { useMemo, useState } from 'react'

import { BuilderCanvas } from './canvas/BuilderCanvas.js'
import type { ChangeOptions, Selection, Tool } from './canvas/types.js'
import { useHistory } from './history.js'
import { AreaInspector } from './panel/AreaInspector.js'
import { RoomInspector } from './panel/RoomInspector.js'
import { SaveBar } from './panel/SaveBar.js'
import { TemplateDetails } from './panel/TemplateDetails.js'
import { ToolBar, type UnfittedArea } from './panel/ToolBar.js'

/**
 * The office builder.
 *
 * It takes a layout and emits a layout. It does not know whether the host will
 * write a file, save a platform template or save an org template — the free app
 * downloads `template.json`, the wrapper apps save to a database, and the
 * component is the same in all three.
 *
 * The panel on the right is always visible and never collapses into a menu. Every
 * control is one click away, which matters because drawing a layout is a loop of
 * draw, look, adjust, and a menu in the middle of that loop is felt on every
 * iteration.
 *
 * What is left in this file is the assembly: the canvas, the panel, the selection
 * they share and the history they both write to. Each part of the panel is its own
 * file, because they are unrelated jobs that happen to sit in one column.
 */

export interface OfficeBuilderProps {
  template: Template
  imageUrl: string | null
  darkImageUrl?: string | null
  /** What the host's save button says and does. Download here; Save elsewhere. */
  saveLabel: string
  onSave(template: Template): void
  /** Lets the host swap the images; the builder does not store files. */
  onPickImage?(which: 'light' | 'dark'): void
}

export function OfficeBuilder(props: OfficeBuilderProps) {
  const history = useHistory(props.template)
  const template = history.value

  const [tool, setTool] = useState<Tool>('select')
  const [selection, setSelection] = useState<Selection>({ kind: 'none' })
  const [showGhosts, setShowGhosts] = useState(true)
  const [showDark, setShowDark] = useState(false)
  const [unfitted, setUnfitted] = useState<UnfittedArea[]>([])

  const validation = useMemo(() => validateTemplate(template), [template])
  const issues: TemplateIssue[] = validation.ok ? [] : validation.issues

  const room =
    selection.kind !== 'none' && 'roomId' in selection
      ? template.rooms.find((candidate) => candidate.id === selection.roomId)
      : undefined
  const area =
    selection.kind === 'area'
      ? room?.areas.find((candidate) => candidate.id === selection.areaId)
      : undefined

  /**
   * One way in for every change, so undo behaves the same wherever it came from.
   *
   * A drag reports continuously and must not leave a hundred steps behind it: the
   * gesture says what the template was before it started, and everything until the
   * pointer comes up replaces that one step.
   */
  const update = (next: Template, options?: ChangeOptions) => {
    if (options?.before) history.commit(options.before)
    if (options?.transient || options?.before) history.replace(next)
    else history.set(next)
  }

  const changeAvatarSize = (size: AvatarSize) => {
    const result = withAvatarSize(template, size)
    history.set(result.template)
    // Rather than silently shrinking somebody's 3x2 huddle, say which areas no
    // longer fit and let the author decide what to do about it.
    setUnfitted(result.unfitted)
  }

  return (
    <div className="grid h-full gap-4 p-4 lg:grid-cols-[1fr_22rem]">
      <div className="min-w-0">
        <BuilderCanvas
          template={template}
          imageUrl={showDark ? (props.darkImageUrl ?? props.imageUrl) : props.imageUrl}
          tool={tool}
          selection={selection}
          onSelect={setSelection}
          onChange={update}
          onToolDone={() => setTool('select')}
          showGhosts={showGhosts}
        />

        <p className="mt-2 text-xs text-base-content/70">
          {tool === 'room'
            ? 'Drag on the canvas to draw a room.'
            : tool === 'area'
              ? 'Drag inside a room to draw a user area. It snaps to whole avatar cells.'
              : 'Click to select. Drag a room to move it, or its bottom-right corner to resize.'}
        </p>
      </div>

      <aside className="flex min-w-0 flex-col gap-4 overflow-y-auto" aria-label="Builder controls">
        <ToolBar
          template={template}
          tool={tool}
          onTool={setTool}
          onUndo={history.undo}
          onRedo={history.redo}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          onAvatarSize={changeAvatarSize}
          unfitted={unfitted}
          onSelect={setSelection}
          showGhosts={showGhosts}
          onShowGhosts={setShowGhosts}
          {...(props.darkImageUrl ? { showDark, onShowDark: setShowDark } : {})}
          {...(props.onPickImage ? { onPickImage: props.onPickImage } : {})}
        />

        {/* One of three, and never two: what is selected decides what is editable. */}
        <section className="border-t border-base-300 pt-3">
          {room && selection.kind === 'room' && (
            <RoomInspector
              template={template}
              room={room}
              onChange={history.set}
              onSelect={setSelection}
            />
          )}

          {room && area && selection.kind === 'area' && (
            <AreaInspector
              template={template}
              room={room}
              area={area}
              onChange={history.set}
              onSelect={setSelection}
            />
          )}

          {selection.kind === 'none' && (
            <TemplateDetails template={template} onChange={history.set} onSelect={setSelection} />
          )}
        </section>

        {/*
          Live validation with the reasons visible. An author finds out while they
          are causing a problem, not when they try to save.
        */}
        <SaveBar issues={issues} saveLabel={props.saveLabel} onSave={() => props.onSave(template)} />
      </aside>
    </div>
  )
}
