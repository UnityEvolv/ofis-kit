import { barRect, type CanvasShape, type Rect, type Room } from '@unityevolv/ofiskit-template'

import type { Unit } from './geometry.js'
import type { Selection } from './types.js'

/**
 * One room on the canvas, with its user areas over it.
 *
 * Drawing only: everything it knows arrives as props, and it changes nothing. The
 * bar is drawn where it will actually be rather than as a label, because the whole
 * reason an author moves it to the other edge is that it lands on something in the
 * picture, and they cannot judge that from a legend.
 */

const percent = (rect: Rect) => ({
  left: `${rect.x * 100}%`,
  top: `${rect.y * 100}%`,
  width: `${rect.width * 100}%`,
  height: `${rect.height * 100}%`,
})

export function RoomShape(props: {
  room: Room
  canvas: CanvasShape
  unit: Unit
  selection: Selection
  /** Draws a ghost avatar in every cell, so a full room can be judged empty. */
  showGhosts: boolean
}) {
  const { room, canvas, unit, selection, showGhosts } = props
  const chosen = selection.kind !== 'none' && 'roomId' in selection && selection.roomId === room.id
  const bar = barRect(room.rect, room.bar, canvas)

  return (
    <div>
      <div
        className={[
          'absolute rounded-sm border-2',
          chosen ? 'border-primary bg-primary/10' : 'border-base-content/50 bg-base-content/5',
        ].join(' ')}
        style={percent(room.rect)}
      >
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
            style={percent({
              x: area.x,
              y: area.y,
              width: area.columns * unit.width,
              height: area.rows * unit.height,
            })}
          >
            {/* Ghost avatars: the author sees how a full room looks before
                anybody is in it. */}
            {showGhosts && (
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
}

export { percent }
