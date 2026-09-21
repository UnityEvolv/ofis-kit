import { Button, Icon, Input } from '@unityevolv/unitykit'
import type { Room, Template, UserArea } from '@unityevolv/ofiskit-template'

import { mapRoom } from '../canvas/geometry.js'
import type { Selection } from '../canvas/types.js'

/**
 * How many people a user area holds.
 *
 * Two numbers, and they are whole ones. A fractional area is not something the
 * author is warned about; it is something they cannot make — emptying the field
 * resolves to one cell rather than to nothing, because a half-typed number should
 * not make the layout invalid while somebody is still typing it.
 */

const LIMIT = 12

export function AreaInspector(props: {
  template: Template
  room: Room
  area: UserArea
  onChange(template: Template): void
  onSelect(selection: Selection): void
}) {
  const { template, room, area } = props

  const setCells = (axis: 'columns' | 'rows', value: string) => {
    const next = Math.max(1, Math.min(LIMIT, Number(value) || 1))
    props.onChange(
      mapRoom(template, room.id, (one) => ({
        ...one,
        areas: one.areas.map((candidate) =>
          candidate.id === area.id ? { ...candidate, [axis]: next } : candidate,
        ),
      })),
    )
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">User area in {room.name}</h3>

      <div className="flex gap-2">
        {(['columns', 'rows'] as const).map((axis) => (
          <Input
            key={axis}
            label={axis === 'columns' ? 'Across' : 'Down'}
            type="number"
            min={1}
            max={LIMIT}
            value={area[axis]}
            onChange={(event) => setCells(axis, event.target.value)}
          />
        ))}
      </div>

      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          props.onChange(
            mapRoom(template, room.id, (one) => ({
              ...one,
              areas: one.areas.filter((candidate) => candidate.id !== area.id),
            })),
          )
          props.onSelect({ kind: 'room', roomId: room.id })
        }}
      >
        <Icon name="trash" size="sm" /> Delete area
      </Button>
    </div>
  )
}
