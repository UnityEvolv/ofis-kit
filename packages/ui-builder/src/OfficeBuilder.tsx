import { Alert, Button, Icon, Input, Select, Textarea, Toggle } from '@unityevolv/unitykit'
import {
  AVATAR_SIZES,
  MAX_ROOMS,
  isRequired,
  validateTemplate,
  withAvatarSize,
  type AvatarSize,
  type Template,
  type TemplateIssue,
} from '@unityevolv/ofiskit-template'
import { useMemo, useState } from 'react'

import { BuilderCanvas, type Selection, type Tool } from './BuilderCanvas.js'
import { useHistory } from './history.js'

/**
 * The office builder.
 *
 * It takes a layout and emits a layout. It does not know whether the host will
 * write a file, save a platform template or save an org template — the free app
 * downloads `template.json`, the wrapper apps save to a database, and the
 * component is the same in all three.
 *
 * The panel on the right is always visible and never collapses into a menu.
 * Every control is one click away, which matters because drawing a layout is a
 * loop of draw, look, adjust, and a menu in the middle of that loop is felt on
 * every iteration.
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
  const [unfitted, setUnfitted] = useState<
    Array<{ roomId: string; roomName: string; areaId: string }>
  >([])

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

  const update = (next: Template, options?: { transient?: boolean; before?: Template }) => {
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
        <section className="space-y-2">
          <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant={tool === 'room' ? 'primary' : 'ghost'}
              onClick={() => setTool(tool === 'room' ? 'select' : 'room')}
              disabled={template.rooms.length >= MAX_ROOMS}
            >
              <Icon name="plus" size="sm" /> Room
            </Button>
            <Button
              size="sm"
              variant={tool === 'area' ? 'primary' : 'ghost'}
              onClick={() => setTool(tool === 'area' ? 'select' : 'area')}
            >
              <Icon name="plus" size="sm" /> User area
            </Button>
            <Button size="sm" variant="ghost" onClick={history.undo} disabled={!history.canUndo}>
              Undo
            </Button>
            <Button size="sm" variant="ghost" onClick={history.redo} disabled={!history.canRedo}>
              Redo
            </Button>
          </div>

          <Select
            label="Avatar size"
            help="Sets the cell size for the whole template."
            value={template.avatarSize}
            onChange={(event) => changeAvatarSize(event.target.value as AvatarSize)}
          >
            {AVATAR_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </Select>

          {unfitted.length > 0 && (
            <Alert variant="warn" title="Some user areas no longer fit">
              <ul className="mt-1 space-y-1 text-xs">
                {unfitted.map((entry) => (
                  <li key={entry.areaId}>
                    <button
                      type="button"
                      className="underline"
                      onClick={() =>
                        setSelection({ kind: 'area', roomId: entry.roomId, areaId: entry.areaId })
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
              checked={showGhosts}
              onChange={(event) => setShowGhosts(event.target.checked)}
              label="Show ghost avatars"
            />
            {props.darkImageUrl && (
              <Toggle
                checked={showDark}
                onChange={(event) => setShowDark(event.target.checked)}
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

        <section className="border-t border-base-300 pt-3">
          {room && selection.kind === 'room' && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">{room.name}</h3>

              <Input
                label="Name"
                value={room.name}
                onChange={(event) =>
                  history.set({
                    ...template,
                    rooms: template.rooms.map((one) =>
                      one.id === room.id ? { ...one, name: event.target.value } : one,
                    ),
                  })
                }
              />

              <Select
                label="Type"
                value={room.type}
                // Reception and the break room are structural: there is
                // exactly one of each, so their type is not a choice.
                disabled={isRequired(room.type)}
                onChange={(event) =>
                  history.set({
                    ...template,
                    rooms: template.rooms.map((one) =>
                      one.id === room.id
                        ? { ...one, type: event.target.value as 'workspace' | 'meeting' }
                        : one,
                    ),
                  })
                }
              >
                <option value="workspace">Workspace</option>
                <option value="meeting">Meeting</option>
                {isRequired(room.type) && <option value={room.type}>{room.type}</option>}
              </Select>

              <Select
                label="Control bar"
                help="Put it on whichever edge is clearer in your picture."
                value={room.bar}
                onChange={(event) =>
                  history.set({
                    ...template,
                    rooms: template.rooms.map((one) =>
                      one.id === room.id
                        ? { ...one, bar: event.target.value as 'top' | 'bottom' }
                        : one,
                    ),
                  })
                }
              >
                <option value="top">Top</option>
                <option value="bottom">Bottom</option>
              </Select>

              <div>
                <p className="text-xs font-medium text-base-content/70">User areas</p>
                <ul className="mt-1 space-y-1">
                  {room.areas.map((one) => (
                    <li key={one.id}>
                      <button
                        type="button"
                        onClick={() =>
                          setSelection({ kind: 'area', roomId: room.id, areaId: one.id })
                        }
                        className="w-full rounded px-2 py-1 text-left text-xs hover:bg-base-200"
                      >
                        {one.columns}x{one.rows} cells
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Absent, not disabled, for the three seeded rooms: a template
                  can never be short of a reception, so deleting one is not a
                  thing the builder has to refuse. */}
              {!isRequired(room.type) && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    history.set({
                      ...template,
                      rooms: template.rooms.filter((one) => one.id !== room.id),
                    })
                    setSelection({ kind: 'none' })
                  }}
                >
                  <Icon name="trash" size="sm" /> Delete room
                </Button>
              )}
            </div>
          )}

          {area && room && selection.kind === 'area' && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">User area in {room.name}</h3>

              <div className="flex gap-2">
                {(['columns', 'rows'] as const).map((axis) => (
                  <Input
                    key={axis}
                    label={axis === 'columns' ? 'Across' : 'Down'}
                    type="number"
                    min={1}
                    max={12}
                    value={area[axis]}
                    onChange={(event) => {
                      const next = Math.max(1, Math.min(12, Number(event.target.value) || 1))
                      history.set({
                        ...template,
                        rooms: template.rooms.map((one) =>
                          one.id === room.id
                            ? {
                                ...one,
                                areas: one.areas.map((candidate) =>
                                  candidate.id === area.id
                                    ? { ...candidate, [axis]: next }
                                    : candidate,
                                ),
                              }
                            : one,
                        ),
                      })
                    }}
                  />
                ))}
              </div>

              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  history.set({
                    ...template,
                    rooms: template.rooms.map((one) =>
                      one.id === room.id
                        ? {
                            ...one,
                            areas: one.areas.filter((candidate) => candidate.id !== area.id),
                          }
                        : one,
                    ),
                  })
                  setSelection({ kind: 'room', roomId: room.id })
                }}
              >
                <Icon name="trash" size="sm" /> Delete area
              </Button>
            </div>
          )}

          {selection.kind === 'none' && (
            <div className="space-y-2">
              <Input
                label="Template name"
                value={template.name}
                onChange={(event) => history.set({ ...template, name: event.target.value })}
              />

              <Textarea
                label="Description"
                rows={2}
                value={template.description ?? ''}
                onChange={(event) => history.set({ ...template, description: event.target.value })}
              />

              <p className="text-xs text-base-content/70">
                {template.rooms.length} of {MAX_ROOMS} rooms.
              </p>

              {/*
                Every room, as a button.

                This is how a room is selected without a pointer, which is the
                difference between a tool somebody can use from the keyboard and
                one where the canvas is the only way in. It is also faster than
                hunting for a small room in a busy picture.
              */}
              <ul className="space-y-1" aria-label="Rooms">
                {template.rooms.map((one) => (
                  <li key={one.id}>
                    <button
                      type="button"
                      onClick={() => setSelection({ kind: 'room', roomId: one.id })}
                      className="w-full rounded px-2 py-1 text-left text-xs hover:bg-base-200"
                    >
                      {one.name}
                      <span className="ml-1 text-base-content/60">{one.type}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/*
          Live validation with the reasons visible. An author finds out while
          they are causing a problem, not when they try to save.
        */}
        <section className="border-t border-base-300 pt-3">
          {issues.length === 0 ? (
            <p className="flex items-center gap-1 text-sm text-success">
              <Icon name="check" size="sm" /> This layout is valid.
            </p>
          ) : (
            <Alert variant="warn" title={`${issues.length} to fix`}>
              <ul className="mt-1 space-y-1 text-xs">
                {issues.slice(0, 6).map((issue, index) => (
                  <li key={`${issue.code}-${index}`}>{issue.message}</li>
                ))}
              </ul>
            </Alert>
          )}

          <Button
            className="mt-3 w-full"
            disabled={issues.length > 0}
            onClick={() => props.onSave(template)}
          >
            <Icon name="download" size="sm" /> {props.saveLabel}
          </Button>
        </section>
      </aside>
    </div>
  )
}
