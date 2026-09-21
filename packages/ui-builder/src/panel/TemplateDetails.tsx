import { Input, Textarea } from '@unityevolv/unitykit'
import { MAX_ROOMS, type Template } from '@unityevolv/ofiskit-template'

import type { Selection } from '../canvas/types.js'

/**
 * The whole template, shown when nothing in particular is selected.
 *
 * Its name and description, and every room as a button. That list is how a room is
 * selected without a pointer, which is the difference between a tool somebody can
 * use from the keyboard and one where the canvas is the only way in — and it is
 * faster anyway than hunting for a small room in a busy picture.
 */

export function TemplateDetails(props: {
  template: Template
  onChange(template: Template): void
  onSelect(selection: Selection): void
}) {
  const { template } = props

  return (
    <div className="space-y-2">
      <Input
        label="Template name"
        value={template.name}
        onChange={(event) => props.onChange({ ...template, name: event.target.value })}
      />

      <Textarea
        label="Description"
        rows={2}
        value={template.description ?? ''}
        onChange={(event) => props.onChange({ ...template, description: event.target.value })}
      />

      <p className="text-xs text-base-content/70">
        {template.rooms.length} of {MAX_ROOMS} rooms.
      </p>

      <ul className="space-y-1" aria-label="Rooms">
        {template.rooms.map((one) => (
          <li key={one.id}>
            <button
              type="button"
              onClick={() => props.onSelect({ kind: 'room', roomId: one.id })}
              className="w-full rounded px-2 py-1 text-left text-xs hover:bg-base-200"
            >
              {one.name}
              <span className="ml-1 text-base-content/60">{one.type}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
