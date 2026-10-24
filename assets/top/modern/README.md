# Modern office, top-down

The Modern office seen from directly above, as a floor plan: a building slab with an outer wall,
rooms as rectangles separated by 60 px corridors, doors as gaps in the wall with a dashed swing
arc onto the corridor, windows drawn on the outer wall line, and furniture seen from the top. A
slight tilt is suggested, not drawn: every wall has a thin lit top edge, a shaded inner face under
its north run and a soft shadow cast south onto the corridor, so rooms sit _on_ the slab rather
than floating in it. Nothing animates.

The theme uses the **same symbol ids as the Modern cutaway** (`docs/office-svg/examples/
modern-cutaway-*.svg`) and the Underwater cutaway (`assets/cut/underwater/`), so a template can
swap themes by swapping its `<defs>` block; only the footprints differ, because a desk from above
is not a desk from the side. `symbols-light.svg` / `symbols-dark.svg` hold every symbol inside
`<defs>` and draw nothing else; the two files have identical geometry and differ only in colours.
A composed example is `docs/office-svg/examples/modern-topdown-landscape.svg` (and `-dark.svg`).
All five files are generated from one script, so light and dark cannot drift.

Drawing rules kept: flat vector, three `feDropShadow` filters (`#sh`, `#shS` for furniture,
`#wallSh` for room and building shells), gradients and patterns, no raster, no `<image>`, no
`<text>`, no faces, no `<script>`/`<style>`, hrefs are `#id` only.

Dark is the same plan at night: deeper floors, darker walls, windows a dark blue with a faint
glint, monitors switched on, lamps glowing wider and warmer, stronger shadows.

## Floors

Floors are 128×128 seamless tiles exposed as `userSpaceOnUse` patterns; a room's bounds rect is
filled with one (`fill="url(#wood)"`). Because the patterns are in user space, tiles stay aligned
across rooms.

| Pattern        | Built from                          | Light base | Dark base |
| -------------- | ----------------------------------- | ---------- | --------- |
| `wood`         | `#floor` (planks, staggered joints) | `#d9bb91`  | `#4b3b2c` |
| `carpetSage`   | colour rect + `#carpet` weave       | `#d7e3d3`  | `#28342b` |
| `carpetBlue`   | colour rect + `#carpet` weave       | `#d5e1ed`  | `#253142` |
| `carpetPlum`   | colour rect + `#carpet` weave       | `#e4d9e9`  | `#332b3b` |
| `carpetCream`  | colour rect + `#carpet` weave       | `#efe8dc`  | `#36322c` |
| `carpetTerra`  | colour rect + `#carpet` weave       | `#efdccb`  | `#3d2f29` |
| `corridorTile` | `#corridor` (64 px stone tiles)     | `#e7e3dc`  | `#2b2e35` |

## Palette

| Role                                      | Light                                                       | Dark                                                        |
| ----------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| Ground / pavement / path                  | `#cfdac3` / `#dedad1` / `#cbc5b9`                           | `#15201a` / `#23272b` / `#2e3236`                           |
| Trees (light / dark)                      | `#7fae7a` / `#5f9060`                                       | `#2d4a35` / `#203a28`                                       |
| Corridor slab / tile line                 | `#e7e3dc` / `#d3cec5`                                       | `#2b2e35` / `#212429`                                       |
| Wall top / lit edge / inner face          | `#ddd5c9` / `#ffffff` @ 0.7 / `#000` @ 0.12                 | `#4c515b` / `#9aa3b3` @ 0.35 / `#000` @ 0.38                |
| Outer wall                                | `#b9ad9d`                                                   | `#5e636e`                                                   |
| Wood plank / highlight / line             | `#d9bb91` / `#ead2ac` / `#c09c6c`                           | `#4b3b2c` / `#584632` / `#3a2c20`                           |
| Carpet weave                              | `#000` @ 0.06                                               | `#fff` @ 0.04                                               |
| Door threshold / leaf / swing arc         | `#cbc2b4` / `#a37c5f` / `#8a7a66`                           | `#3f434c` / `#6b5540` / `#7a8292`                           |
| Window glass `glassG` / frame / mullion   | `#bfe0f5` → `#e9f5fc` / `#ffffff` / `#dfe6ea`               | `#121d33` → `#1f2f4b` / `#5b6474` / `#3b4556`               |
| Window glint                              | `#ffffff` @ 0.6                                             | `#9fc3ff` @ 0.25                                            |
| Desk top / edge                           | `#f1e5d3` / `#c9b08e`                                       | `#5c4f41` / `#3f362c`                                       |
| Monitor / screen / keyboard / keys        | `#3d405b` / `#7fb7e6` / `#c9d3da` / `#9fadb8`               | `#1f2233` / `#6fb0f0` / `#3b4452` / `#2b323d`               |
| Mouse                                     | `#e8edf0`                                                   | `#4d5663`                                                   |
| Chair seat / seat highlight / back / arm  | `#5f7089` / `#7a8ca6` / `#4d5d73` / `#3b4a5c`               | `#3a4556` / `#4a5669` / `#2d3645` / `#222a36`               |
| Table / edge / runner                     | `#e6d2b7` / `#b89a75` / `#81b29a`                           | `#574636` / `#3b2f24` / `#3f6b5a`                           |
| Café table / edge / cup / coffee          | `#f1e5d3` / `#c9b08e` / `#ffffff` / `#6b4a2b`               | `#5c4f41` / `#3f362c` / `#cfd6dc` / `#3a2616`               |
| Stool / ring                              | `#d9884e` / `#c97840`                                       | `#8a5233` / `#6f4228`                                       |
| Sofa / cushion / arm / pillows            | `#d9884e` / `#e69a63` / `#c97840` / `#f2c9a1` `#7fb7a3`     | `#7a4a2e` / `#8f5a3a` / `#66402a` / `#a0785a` `#3f6b5a`     |
| Bookshelf / inner                         | `#a37c5f` / `#7a5a44`                                       | `#4d3a2c` / `#342619`                                       |
| Book spines                               | `#e07a5f` `#3d405b` `#81b29a` `#f2cc8f` `#8fa9c9` `#f4d35e` | `#9d5e4e` `#2a2d44` `#4e7a66` `#a08a5a` `#5a6f8a` `#a08c3f` |
| Whiteboard / frame / tray / markers       | `#ffffff` / `#c9d3da` / `#b8c4cc` / `#e07a5f` `#3d7bd6`     | `#c4ccd3` / `#6c7681` / `#5a646e` / `#9d5e4e` `#3a5a8a`     |
| Art frame / canvas `artG`                 | `#d9cbb8` / `#cfe8f5` → `#f6dcc0`                           | `#5c5448` / `#3a4a5a` → `#5a4a3a`                           |
| Plant pot / rim                           | `#b96e4b` / `#d8875f`                                       | `#6b3f2b` / `#7d4a33`                                       |
| Greens                                    | `#4f9a6a` `#5fb27b` `#3f8a5b` `#6cc48a`                     | `#2f6a46` `#3f8a5b` `#244f36` `#4da66c`                     |
| Lamp shade / bulb / glow `lampGlow`       | `#f4d35e` / `#fff8d6` / `#ffe7a8` @ 0.45                    | `#ffd868` / `#fff6c8` / `#ffc766` @ 0.65                    |
| Counter / top / lip / bell                | `#7a5a44` / `#b58c6b` / `#6a4c38` / `#f4d35e`               | `#3e2e22` / `#5a4433` / `#2f2219` / `#d8b24a`               |
| Kitchen worktop / sink / basin / tap      | `#cfd8dc` / `#90a4ae` / `#78909c` / `#eceff1`               | `#3b4552` / `#566370` / `#44515c` / `#a9b4bd`               |
| Hob / burner / fridge / fridge line       | `#455a64` / `#eceff1` / `#eceff1` / `#b0bec5`               | `#1f272e` / `#5a6670` / `#4a545e` / `#2e3640`               |
| Rug / border                              | `#c96f4f` @ 0.55 / `#e9c9a0` @ 0.75                         | `#8a4a34` @ 0.6 / `#a07a52` @ 0.55                          |
| Clock face / rim and hands                | `#ffffff` / `#3d405b`                                       | `#d7dde1` / `#1f2233`                                       |
| Pillar / highlight / shade                | `#cfc6b8` / `#fff` @ 0.55 / `#000` @ 0.14                   | `#4a4f5a` / `#9aa3b3` @ 0.35 / `#000` @ 0.45                |
| Drop-shadow flood `sh` / `shS` / `wallSh` | `#5a4632` @ 0.22 / 0.25 / 0.26                              | `#000000` @ 0.45 / 0.5 / 0.55                               |

## Symbols

Footprints are the drawn extent relative to the symbol's own origin (x range × y range). Origins:
**top-left** for rectangular furniture and wall-mounted items (the wall runs along the item's top
edge), **centre** for round things and anything that is rotated in place, the **hinge** for the
door. Rotate with `transform="translate(x y) rotate(a)"` on the `<use>`: a chair faces +y at 0°,
−x at 90°, −y at 180°, +x at −90°. A wall item goes on the north wall unrotated, on the south wall
with `rotate(180)` (origin at its right end), on the west wall with `rotate(-90)` (origin at its
bottom end) and on the east wall with `rotate(90)`.

| Symbol       | Footprint (px)                | Origin   | What it is                                                                                                                                                                          |
| ------------ | ----------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `floor`      | 128 × 128                     | top-left | Seamless wood tile: four 32 px planks, staggered joints, faint grain; used by the `wood` pattern                                                                                    |
| `carpet`     | 128 × 128                     | top-left | Seamless diagonal weave, lines only; laid over a colour rect by the `carpet*` patterns                                                                                              |
| `corridor`   | 128 × 128                     | top-left | Seamless stone tile, 64 px grid; used by the `corridorTile` pattern                                                                                                                 |
| `pillar`     | 24 × 24                       | top-left | Square column from above, lit top-left, shaded right                                                                                                                                |
| `desk`       | 120 × 60                      | top-left | Desk top with a monitor bar and stand at the top edge, keyboard and mouse; surface otherwise clear. The seat side is the bottom edge                                                |
| `chair`      | 40 × 36 (−20…20 × −20…16)     | centre   | Office chair: backrest at the top, seat, two armrests                                                                                                                               |
| `table`      | 200 × 90                      | top-left | Long meeting table with a centre runner                                                                                                                                             |
| `cafe`       | ⌀ 70 (−35…35)                 | centre   | Round café table with one cup                                                                                                                                                       |
| `stool`      | ⌀ 24 (−12…12)                 | centre   | Round stool                                                                                                                                                                         |
| `sofa`       | 150 × 60                      | top-left | Two-seat sofa: backrest along the top edge, two cushions, two pillows, armrests                                                                                                     |
| `bookshelf`  | 120 × 30                      | top-left | Thin shelf against a wall, a row of spines seen from above                                                                                                                          |
| `whiteboard` | 140 × 15 (0…140 × 0…15)       | top-left | Board on the wall line with a marker tray toward the room                                                                                                                           |
| `art`        | 60 × 12                       | top-left | Framed picture on a wall, a gradient canvas                                                                                                                                         |
| `plant`      | ⌀ 52 (−24…25 × −20…22)        | centre   | Pot with four overlapping leaf clumps                                                                                                                                               |
| `tallplant`  | ⌀ 72 (−36…36)                 | centre   | Six long leaves radiating from a pot                                                                                                                                                |
| `lamp`       | ⌀ 30 shade, ⌀ 120 glow        | centre   | Floor lamp: shade, bulb and a soft radial glow (stronger in dark)                                                                                                                   |
| `window`     | 120 × 14 (centre line at y=7) | top-left | Glazing segment with two mullions, drawn **on** the wall line: place at wall − 7                                                                                                    |
| `counter`    | 200 × 50                      | top-left | Reception counter: top with a bell, a small plant and a monitor; the lip is the visitor side (bottom edge)                                                                          |
| `kitchen`    | 220 × 50                      | top-left | Kitchen run against a wall: sink with tap, four-ring hob, fridge at the right end                                                                                                   |
| `rug`        | 200 × 120 (−100…100 × −60…60) | centre   | Translucent rug with a border; areas may sit on it                                                                                                                                  |
| `clock`      | ⌀ 31 (−15.5…15.5)             | centre   | Round clock with hands; set its centre on a wall line                                                                                                                               |
| `door`       | 62 × 64 (−2…62 × −8…56)       | hinge    | Extra: a 60 px gap in the wall (threshold covers a 12 px wall), the open leaf along +y and a dashed quarter-circle swing from the leaf tip back to the wall. Rotate for other walls |

Every symbol with a shadow carries its own `filter`; a `<use>` needs none.

## Composing a plan

- The building is a rect filled with `corridorTile` and stroked 16 px with the outer wall colour,
  inset 60 px from the canvas; rooms are rects filled with a floor pattern and stroked 12 px with
  the wall-top colour (`filter="url(#wallSh)"` for the cast shadow), then a 2 px lit outline
  5 px outside the edge and an 8 px shaded band under the north wall inside the room.
- Corridors are simply the slab showing between rooms; 60 px fits a `door` swing exactly.
- Doors and pillars go in `<g id="overlay">` so the threshold paints over the room's wall stroke.
- Keep the user area on open floor or a rug; the control bar covers the top 45 px of a room on a
  landscape canvas, so anything drawn there (the north windows of the top row) is hidden in the
  product.
