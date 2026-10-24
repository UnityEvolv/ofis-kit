# Drawing an office: the designer guide

The one-page version of the [spec](spec.md), for someone drawing in Figma. Do
these and the builder opens with every room already placed.

## Checklist

1. **One frame per room**, named `room-<type>-<Name>`. Types: `reception`,
   `break`, `workspace`, `meeting`, `conference`. Use underscores for spaces:
   `room-meeting-Design_studio`. Exactly one reception and one break room.
2. **Give the room frame a fill.** The fill becomes the room's outline when
   exported, and the importer reads the room's bounds from it. A frame with no
   fill exports with no rect and the room is not found.
3. **Everything inside the room goes inside its frame**: furniture, windows,
   wall colour. Anything shared (sky, building shell, floor slabs) goes in a
   frame named `backdrop` behind the rooms; pillars between rooms go in a frame
   named `overlay` in front.
4. **Mark where people stand** with a rectangle layer named `area-<cols>x<rows>`
   inside the room, at 0% fill opacity. Size it from the table below so the
   furniture leaves it clear. One per room is enough; more is fine.
5. **No text layers**, anywhere. Room names are drawn by the product on the
   room's bar. No logos, no people, no faces.
6. **Bar edge**: the product draws a 32 px bar along the top of each room (or
   the bottom, if you set `data-bar="bottom"` after export). Keep that strip
   calm.
7. **Export as SVG** with "Include id attribute" on, at the frame's size. Export
   the light and the dark version from the same frames; only colours may
   differ.
8. **Add to the root `<svg>`**: `data-ofis="1" data-canvas="landscape"`
   `data-avatar="small"` (or whichever you drew for). The builder assumes
   `medium` if you forget.
9. **Check it**: drop the file on the builder's background step. It lists every
   problem with the room named, and nothing is saved until you say so.

## Sizes

Canvas frames: landscape 1920×1080, square 1080×1080, portrait 1080×1440.

One avatar cell (what one `area-1x1` covers), in pixels on that canvas:

| Canvas    | small    | medium    | large     |
| --------- | -------- | --------- | --------- |
| landscape | 90 × 120 | 120 × 161 | 165 × 214 |
| square    | 68 × 90  | 90 × 121  | 124 × 160 |
| portrait  | 90 × 120 | 120 × 161 | 165 × 214 |

Minimum room: wide enough for the bar (about 315 px on a landscape canvas) and
tall enough for the bar plus one cell. The importer tells you if a room is too
small.

## What makes a room read well

- Furniture is the layout. Chairs around tables, a desk with its chair, a
  counter in reception, a kitchen along the café wall. An empty room should
  still look like somewhere.
- Leave the floor in front of the furniture clear: that is where the area goes
  and where avatars stand.
- Nothing tall on a desk or table, and a plain wall behind each seat, so a face
  and a name read against it.
- Keep contrast moderate. Bars, status dots and avatars are drawn on top, in
  both light and dark, and they have to win.
- Draw the dark version as the same scene after sunset, not a different room:
  lamps on, windows dark, colours deeper. The geometry must not move.

## Starting points

Pick a view first: **cutaway** (a building seen from the front with the wall
removed; rooms on levels) or **top-down** (a floor plan from above; rooms can be
rectangles, round pods or, in Galaxy, planets). The symbol libraries live under
`assets/<view>/<theme>/`; copy a library's `<defs>` and place symbols with
`<use href="#desk" x="…" y="…"/>`.

- [examples/](examples/) holds one finished office per theme, view and canvas,
  light and dark, every rule followed. `modern-cutaway-landscape.svg` and
  `underwater-cutaway-landscape.svg` draw the same nine rooms, so you can see
  what changes between themes (symbols and palette) and what does not (rooms).
- Square (1080×1080) and portrait (1080×1440) examples show how the same themes
  fit the other canvases: fewer rooms per level, more levels.
- A round room (a pod, a planet) starts with an invisible bounding rect and then
  the shape; see the Galaxy and Underwater top-down examples.
