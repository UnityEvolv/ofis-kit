import { Button, Icon, Input, Select } from '@unityevolv/unitykit'
import { isRequired, type Room, type Template } from '@unityevolv/ofiskit-template'

import { mapRoom } from '../canvas/geometry.js'
import type { Selection } from '../canvas/types.js'

/**
 * The selected room's own settings.
 *
 * Its name, what kind of room it is, which edge its control bar sits on, and the
 * user areas in it. Nothing about geometry: a room is moved and resized on the
 * canvas, where the author can see what they are doing to it.
 */

export function RoomInspector(props: {
  template: Template
  room: Room
  onChange(template: Template): void
  onSelect(selection: Selection): void
}) {
  const { template, room } = props
  const edit = (change: (one: Room) => Room) => props.onChange(mapRoom(template, room.id, change))

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{room.name}</h3>

      <Input
        label="Name"
        value={room.name}
        onChange={(event) => edit((one) => ({ ...one, name: event.target.value }))}
      />

      <Select
        label="Type"
        value={room.type}
        // Reception and the break room are structural: there is exactly one of
        // each, so their type is not a choice.
        disabled={isRequired(room.type)}
        onChange={(event) =>
          edit((one) => ({ ...one, type: event.target.value as 'workspace' | 'meeting' }))
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
        onChange={(event) => edit((one) => ({ ...one, bar: event.target.value as 'top' | 'bottom' }))}
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
                onClick={() => props.onSelect({ kind: 'area', roomId: room.id, areaId: one.id })}
                className="w-full rounded px-2 py-1 text-left text-xs hover:bg-base-200"
              >
                {one.columns}x{one.rows} cells
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Absent, not disabled, for the three seeded rooms: a template can never
          be short of a reception, so deleting one is not a thing the builder has
          to refuse. */}
      {!isRequired(room.type) && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            props.onChange({
              ...template,
              rooms: template.rooms.filter((one) => one.id !== room.id),
            })
            props.onSelect({ kind: 'none' })
          }}
        >
          <Icon name="trash" size="sm" /> Delete room
        </Button>
      )}
    </div>
  )
}
