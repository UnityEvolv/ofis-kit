# Underwater theme, top-down

The seabed habitat seen from directly above. Rooms are pods: rounded rectangles or ellipses with a
riveted hull rim, joined by ribbed tube corridors with a hatch where each tube meets a pod wall.
Pod floors are warm sand or driftwood decking (each pod lightly tinted), so the pods pop off the
blue water; outside them lie sand drifts, caustic light rings, rocks, coral, kelp, bubbles, an
anchor and a few fish. Nothing animates and nothing is drawn in perspective: every symbol is its
plan view.

`symbols-light.svg` / `symbols-dark.svg` hold every symbol inside `<defs>` and draw nothing else;
the two files have identical geometry and differ only in colours. The symbol ids are the same as the
cutaway Underwater theme and the Modern office, so a template swaps themes by swapping `<defs>`; the
footprints differ because these are plan views. A composed example lives in
`docs/office-svg/examples/underwater-topdown-landscape.svg` (and `-dark.svg`). The four SVG files
come from one generator script with two palettes, so light and dark cannot drift apart.

Drawing rules kept: flat vector, gradients, patterns and the two `feDropShadow` filters (`#sh`,
`#shS`), no raster, no `<image>`, no `<text>`, no faces, no `<script>`/`<style>`, hrefs are `#id`
only.

## Palette

| Role                                             | Light                                                             | Dark                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| Water (`water`, radial centre → edge)            | `#3f8fbd` → `#1b5a88`                                             | `#0c2e4a` → `#04111f`                                             |
| Caustic rings (`caustic` pattern)                | `#ffffff` @ 0.07                                                  | `#9fd0ff` @ 0.045                                                 |
| Sand / sand light / sand dark (seabed, rug)      | `#d9c39a` / `#ead9b6` / `#b9a27a`                                 | `#4a3f2f` / `#5a4d3a` / `#2a2219`                                 |
| Floor tile base / ripple / speck (`floor`)       | `#ecdcb6` / `#d6c094` / `#b9a27a`                                 | `#6b5b44` / `#7d6c52` / `#4e412f`                                 |
| Decking plank / seam / grain (`deckPat`)         | `#e3c99c` / `#b8976c` / `#c9ab7c`                                 | `#66543d` / `#3f3222` / `#56462f`                                 |
| Hull band / frame / rivet / rivet shade          | `#cfd6dc` / `#8a98a3` / `#eef3f6` / `#5f6d78`                     | `#3b4752` / `#1a2229` / `#7d8c98` / `#0e1317`                     |
| Tube dark / light / highlight / rib              | `#6f7f8c` / `#b4c0c8` / `#dfe6ea` / `#8a98a3`                     | `#1a2229` / `#3b4752` / `#55636e` / `#0f161b`                     |
| Tube glass strip (`tubeGlass`)                   | `#9fd0ea` → `#dff2fb` @ 0.55                                      | `#1b5578` → `#3f8fbd` @ 0.5                                       |
| Porthole glass `glassG` / `glassR`               | `#2f7db0` → `#8fd0ea`                                             | `#0b2a44` → `#1b5578`                                             |
| Pod tints (teal, sand, kelp, coral, navy, pearl) | `#8ec9c0` `#f6ecd8` `#6cc48a` `#f0a08a` `#7ea0c8` `#e5e0ea` @ 0.2 | `#2f6a66` `#7a6a4c` `#2f6a46` `#7e4a3b` `#253655` `#6a6a78` @ 0.3 |
| Floor vignette (inner edge)                      | `#8a7352` @ 0.14                                                  | `#000000` @ 0.25                                                  |
| Driftwood / dark / table / apron                 | `#d9bf98` / `#b8976c` / `#e2cfae` / `#c7ab82`                     | `#6b5a44` / `#54452f` / `#6f5e45` / `#574a36`                     |
| Coral / coral light / coral dark                 | `#e07a5f` / `#f0a08a` / `#c75f48`                                 | `#9d5e4e` / `#b57461` / `#7e4a3b`                                 |
| Shell / shell mid / shell dark                   | `#f6e3d6` / `#edc9b8` / `#d9a893`                                 | `#c9ae9f` / `#a88a7b` / `#8c6f61`                                 |
| Metal / metal light / metal pale                 | `#6f7f8c` / `#9fb0ba` / `#c4d0d8`                                 | `#4a5663` / `#5f6d78` / `#76858f`                                 |
| Sea-glass teal / dark                            | `#8ec9c0` / `#5fa39b`                                             | `#4e8a82` / `#376a63`                                             |
| Kelp greens                                      | `#3f8a5b` `#5fb27b` `#6cc48a` `#2f6f48`                           | `#2f6a46` `#3f8a5b` `#4da66c` `#244f36`                           |
| Brass / brass dark                               | `#c9a24a` / `#a37f32`                                             | `#a37f32` / `#7a5e24`                                             |
| Slate board / chalk                              | `#3e4a50` / `#eef3f4`                                             | `#1f2a30` / `#b9c6cc`                                             |
| Jellyfish / tentacles / core / glow (`lampGlow`) | `#f7d9e8` / `#e9b9d2` / `#fff3c4` / `#ffe7a8` @ 0.5               | `#d8b4c9` / `#b592a8` / `#fff0c0` / `#ffc766` @ 0.62              |
| Rock light / dark                                | `#9aa5a9` / `#6f7c82`                                             | `#4d5a62` / `#2f3a40`                                             |
| Fish orange / fish pale                          | `#f4a261` / `#f2cc8f`                                             | `#c77a3f` / `#b09562`                                             |
| Pearl, mugs, dials / hands                       | `#fdfaf3` / `#3d405b`                                             | `#cfd6dc` `#d7dde1` / `#cfd6dc`                                   |
| Air tank / tank dark                             | `#5aa3c9` / `#3f7fa3`                                             | `#3f7fa3` / `#2a5c7a`                                             |
| Bubbles                                          | `#ffffff` @ 0.7                                                   | `#cfe6f5` @ 0.5                                                   |
| Drop-shadow flood (`sh` / `shS`)                 | `#0f2a3d` @ 0.28 / 0.25                                           | `#000000` @ 0.5 / 0.5                                             |

Paints in `<defs>`: gradients `water`, `tubeH`, `tubeV`, `tubeGlass`, `glassG`, `glassR`, `artG`,
`lampGlow`; filters `sh`, `shS`; patterns `sandPat` (128×128, tiles the `floor` symbol), `deckPat`
(128×64 staggered planks), `caustic` (180×180 faint light rings laid over the water).

## Symbols

Footprints are the drawn extent relative to the symbol's own origin (x range × y range), seen from
above. Origins are top-left for slabs, boards, desks, counters and the tile; the centre for chairs,
stools, café tables, plants, lamps, the rug, the clock, the fish and the coral. Wall items
(`window`, `whiteboard`, `art`, `bookshelf`) are drawn along the x axis for a top or bottom wall;
rotate them with `transform="translate(x y) rotate(90)"` (left wall) or `rotate(-90)` (right wall).

| id           | Footprint (px)               | Top-down drawing                                                                              |
| ------------ | ---------------------------- | --------------------------------------------------------------------------------------------- |
| `floor`      | 0..128 × 0..128              | Seamless sand tile: ripple lines (period 32) and a few specks; fill pods with `url(#sandPat)` |
| `pillar`     | 0..24 × 0..24                | Hatch / porthole set in the floor: steel ring, glass centre, eight rivets                     |
| `desk`       | 0..120 × 0..60               | Driftwood desk on coral-stone leg caps; a flat tablet and a shell, surface otherwise clear    |
| `chair`      | -19..19 × -17..18            | Scallop-shell chair: round seat, ribbed crescent backrest at the top                          |
| `table`      | 0..200 × 0..90               | Long driftwood table, coral leg caps, one flat chart in the middle                            |
| `cafe`       | -35..35 × -35..35            | Round driftwood table top with a mug and a shell                                              |
| `stool`      | -12..12 × -12..12            | Coral dome seat                                                                               |
| `sofa`       | 0..150 × 0..60               | Clam-shell sofa: ribbed back ridge at the top, two cushions, shell arms                       |
| `bookshelf`  | 0..120 × 0..30               | Coral shelf against a wall, book spines seen from above, a pearl                              |
| `whiteboard` | 0..140 × 0..12               | Slate in a driftwood frame on the wall line, chalk dashes, tray                               |
| `art`        | 0..60 × 0..12                | Brass-framed picture on the wall line                                                         |
| `plant`      | -25..25 × -25..25            | Kelp clump on a rock: six fronds radiating from the rock                                      |
| `tallplant`  | -35..35 × -35..35            | Tall kelp on a rock: eight longer fronds                                                      |
| `lamp`       | -26..26 × -26..26, glow r 50 | Jellyfish lamp seen from above: bell r 15, curling tentacles, warm glow                       |
| `window`     | 0..120 × 0..14               | Porthole strip on the wall line: steel frame, glass inset, rivets                             |
| `counter`    | 0..200 × 0..50               | Treasure-chest reception counter: brass bands, lock plate, rivets                             |
| `kitchen`    | 0..220 × 0..50               | Steel coffee point: sink, two mugs, pressure dial, air tank with valve                        |
| `rug`        | -100..100 × -60..60          | Sand-ripple ellipse rug with a dashed border                                                  |
| `clock`      | -17..17 × -17..17            | Ship's-wheel clock: eight spokes with brass knobs, face r 11                                  |
| `bubbles`    | 0..40 × 0..40                | Static cluster of five bubbles                                                                |
| `rock`       | 0..80 × 0..60                | Seabed boulder from above                                                                     |
| `anchor`     | 0..60 × 0..70                | Anchor lying flat on the sand                                                                 |
| `fish`       | -21..21 × -10..10            | Fish from above, swimming to the right; flip with `scale(-1 1)`                               |
| `coral`      | -30..30 × -30..30            | Branching coral, a brain coral and a fan coral                                                |

## Example layout

Nine pods on a 3×3 grid (rows at y=30, 390 and 760; heights 290/300/300) joined by twelve tube
corridors (44 px wide, ribbed, with a glass strip) drawn in `#backdrop` and 24 hatches drawn in
`#overlay` where the tubes meet the pod walls. Pods are rounded rectangles (`rx` 50–60), the
Meeting room is a pill (`rx` 150) and the Quiet room is an ellipse: its room group starts with an
invisible bounding `<rect fill="none" stroke="none"/>` followed by the ellipse art, as the spec
requires for a round pod. Every other pod's first child is its floor rect (pattern fill, hull
stroke), followed by the tint, vignette, inner hull band and a dashed-stroke rivet ring, then the
furniture, then the `area-<cols>x<rows>` rect. Areas start at least 66 px below the pod top so the
product's control bar never covers them, and nothing but a lamp's glow or a rug lies under them.

The same generator draws the other two canvases from the same symbols:

- `underwater-topdown-square.svg` (1080×1080, `data-canvas="square"`): eight 300-tall pods in a
  3/2/3 grid (rows at y=30, 390, 750); the middle row is the Meeting room pill and the Quiet room
  ellipse. Square cells are 67.5×90 and the bar is 45 px, so areas start at +60 or lower.
- `underwater-topdown-portrait.svg` (1080×1440, `data-canvas="portrait"`): eight pods in two
  columns (490 and 470 wide) and four rows (y=30, 390, 750, 1110), a tube ladder down each column
  and a cross-tube on every row. Cells are 90×120, the bar 60 px, areas from +70.
