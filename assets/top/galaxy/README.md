# Galaxy theme (top-down): a cartoon space base

A bright, toy-like space adventure seen from above. There is no building and there are no planets
with furniture on them: **every room is a different space structure, and the structure is the
furniture**. A red-and-white rocket waits on a gantry over its launch platform (reception), a flying
saucer with a glass dome, a ring of coloured lights and a tractor beam is the break room, and the
workspaces and meeting rooms are a wheel station with solar panels, a moon base with two geodesic
domes, an asteroid mine with a drill rig, a crane, ore carts and a conveyor, a boxy satellite with a
huge dish, a striped planet whose ring is a highway with tiny rovers, a chunky starship with a glowing
bridge canopy, and a comet with a long striped tail and a hitched tug pod.

The style, not any licensed design: thick rounded navy outlines (6-8 px, round joins) on every shape,
flat saturated fills with one lighter highlight band and one darker shadow band, chunky rounded
proportions, big porthole windows with a white glint, four-point sparkle stars, candy-coloured nebula
blobs with outlines, exhaust flames drawn as concentric flame shapes, swooshes behind the shuttles.
Backdrop: a cartoon sun with a corona of chunky rays, a far ringed planet and a wormhole ring in the
right-hand column, dashed flight paths in the gaps between rooms. No faces, no text, no animation.

Every structure has one **calm flat deck** (a plain pale plate, the saucer's inner deck, the station
hub) and the room's area sits on it, so avatar portraits and name labels never land on anything busy.
The top ~50 px of every room, where the product draws its control bar, is kept plain.

`symbols-light.svg` / `symbols-dark.svg` hold every symbol inside `<defs>` and draw nothing else;
the two files have identical ids and geometry and differ only in colours. The composed examples are
`docs/office-svg/examples/galaxy-topdown-{landscape,square,portrait}.svg` (each with a `-dark.svg`),
seven rooms on every canvas; all eight files come from one script with two palettes, so the light and
dark room geometry is identical by construction. A structure is placed with
`<g transform="translate(x y) scale(s)"><use href="#…"/></g>`, so the same symbols serve all three
canvases at different sizes (0.7–0.75 on the square, 0.85–1 on the portrait, 1–1.2 on the landscape).

Drawing rules kept: flat vector, four gradients (space, three glows, one beam), one `feDropShadow`
filter (`#sh`, the rocket) and one `feGaussianBlur` (`#glow`, unused by the example), three clip paths,
no raster, no `<image>`, no `<text>`, no `<script>`/`<style>`, no animation, hrefs are `#id` only.

## Palette

Light Galaxy is a bright blue-violet space; dark Galaxy is deep navy with stronger glows. The fills are
the same bold primaries in both, a touch deeper in dark.

| Role                               | Light                                       | Dark                                        |
| ---------------------------------- | ------------------------------------------- | ------------------------------------------- |
| Space (gradient `space`)           | `#3a3f8a` → `#2b2f6b` → `#232860`           | `#141a44` → `#0b0e2a` → `#070a1f`           |
| Outline ink                        | `#1b1f3a`                                   | `#0a0c22`                                   |
| Cream (hull) / hi / lo             | `#f4f1ea` / `#ffffff` / `#d9d4c8`           | `#e6e2d7` / `#f7f5ef` / `#c3beb0`           |
| Rocket red / hi / lo               | `#e8423f` / `#ff7a6e` / `#b52f2d`           | `#d93a37` / `#f36d62` / `#9a2826`           |
| Lime / hi / lo                     | `#8fd14f` / `#c2ef8a` / `#5f9e2c`           | `#7fc443` / `#b3e37c` / `#4f8a24`           |
| Purple / hi / lo                   | `#7a4fd6` / `#a98af0` / `#55339e`           | `#6c43c7` / `#9b7ae6` / `#482a8c`           |
| Teal / hi / lo                     | `#27c3d6` / `#8fe9f2` / `#178e9e`           | `#22b4c7` / `#7fdde8` / `#137e8d`           |
| Yellow / hi / lo                   | `#ffd23f` / `#ffe98f` / `#d9a712`           | `#f5c62f` / `#ffe27a` / `#c7960c`           |
| Orange / hi / lo                   | `#ff8c42` / `#ffb27a` / `#c9601f`           | `#f07e36` / `#ffa96c` / `#b85417`           |
| Metal grey / hi / lo               | `#b9c1d9` / `#e4e8f3` / `#8b94b3`           | `#a3abc8` / `#d2d7e8` / `#737c9d`           |
| Asteroid rock / hi / lo            | `#b8794b` / `#e0a877` / `#86532f`           | `#a66b40` / `#cf9868` / `#744526`           |
| Moon / hi / lo                     | `#dcdff0` / `#f3f4fb` / `#aeb3cf`           | `#c9cde3` / `#e6e8f5` / `#9a9fbd`           |
| Dome glass (opacity) / comet ice   | `#9be7f0` (.85) / `#e3f7fa`                 | `#7fdbe6` (.85) / `#d2eef3`                 |
| Solar panel / grid                 | `#3d5bd9` / `#6f8af0`                       | `#3550c9` / `#6280ea`                       |
| Stars (opacity)                    | `#ffffff` (.9)                              | `#ffffff` (1)                               |
| Nebula A / B / C (fill op, ink op) | `#ff7bc0` / `#8d6cf0` / `#39d6e8` (.5, .55) | `#f25fae` / `#7a58e6` / `#2bc3d8` (.62, .7) |
| Sun glow / beacon+hole glow        | `#ffd23f` @ .45 / white-teal @ .35          | `#ffb833` @ .6 / @ .5                       |
| Tractor beam                       | `#c2ef8a` @ .6 → 0                          | `#b3e37c` @ .7 → 0                          |
| Flight paths / swooshes            | `#f4f1ea` @ .75                             | `#f4f1ea` @ .7                              |
| Drop shadow (`sh`)                 | `#000000` @ .3                              | `#000000` @ .5                              |

## Symbols

Footprints are the drawn extent relative to the symbol's own origin (x range × y range), outlines
included. Origins: top-left for slabs, desks, tables, racks, boards, the counter, the galley, the
viewport and the conveyor; the centre for everything round and for **every structure** (the rocket,
gantry, drill and crane stand on their origin: bottom centre).

### Shared ids (every top-down theme draws these)

| id           | Footprint (px)                  | Galaxy drawing                                                |
| ------------ | ------------------------------- | ------------------------------------------------------------- |
| `floor`      | 0..128 × 0..128 (seamless tile) | Starfield tile: 18 dots and two sparkles, none near an edge   |
| `pillar`     | -13..13 × -13..13               | Antenna mast with a red tip light                             |
| `desk`       | -2..122 × -2..62                | Console: teal screen strip, keypad, red and yellow buttons    |
| `chair`      | -20..20 × -20..20               | Purple pod seat, backrest crescent on the far side            |
| `table`      | -2..202 × -2..92                | Holo table with a teal projector disc                         |
| `cafe`       | -37..37 × -37..37               | Round holo table                                              |
| `stool`      | -14..14 × -14..14               | Pod stool                                                     |
| `sofa`       | -2..152 × -2..62                | Lounge pod: red capsule, two cream cushions                   |
| `bookshelf`  | -2..122 × -2..32                | Data rack with six coloured blades                            |
| `whiteboard` | 0..140 × -33..14                | Holo board: emitter bar 140×12, translucent projection above  |
| `art`        | 0..60 × -28..14                 | Hologram projector showing a tiny ringed planet               |
| `plant`      | -24..24 × -26..25               | Crystal cluster on a rock                                     |
| `tallplant`  | -34..34 × -36..35               | Large crystal cluster                                         |
| `lamp`       | -16..16 × -16..16, glow to ±30  | Beacon with a yellow glow                                     |
| `window`     | -2..122 × -2..16                | Viewport: navy glass strip with stars                         |
| `counter`    | -2..202 × -2..52                | Docking console: orange, three teal screens                   |
| `kitchen`    | -2..222 × -2..52                | Galley: two hob rings, sink, dispenser, three cups            |
| `rug`        | -102..102 × -62..62             | Landing pad: grey slab, yellow target ring, red corner lights |
| `clock`      | -16..16 × -16..16               | Chrono dial                                                   |

### Structures and backdrop

| id               | Footprint (px)                      | Drawing                                                                                                        |
| ---------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `launchpad`      | -237..237 × -112..124               | Round launch platform, yellow landing ring (centre 58,8 rx 168 ry 86), scorch, rim lights                      |
| `rocket`         | -88..88 × -304..34                  | Standing red-and-white rocket, porthole, fins, nozzle, steam puffs (drop shadow)                               |
| `gantry`         | -33..95 × -339..3                   | Orange lattice tower with a service arm to +92 at y -250                                                       |
| `saucer`         | -204..204 × -184..112, beam to +230 | Saucer: purple deck, calm inner deck (rx 172 ry 86), rim lights, glass dome, tractor beam                      |
| `ringstation`    | -225..225 × -189..189               | Wheel station: cream ring with red stripes, six spokes, two solar panels, calm hub r 118                       |
| `dome`           | -61..61 × -55..14                   | Geodesic dome r 52 on a base ring (scale at the `<use>`)                                                       |
| `moonbase`       | -189..189 × -169..189               | Cratered moon r 185, two domes, antenna, paved apron (-124..124 × -26..136)                                    |
| `asteroid`       | -240..240 × -142..144               | Potato rock with craters and a worked terrace (rx 160 ry 100, cream centre)                                    |
| `drill`          | -43..43 × -122..34                  | A-frame drill rig with a bit below                                                                             |
| `crane`          | -122..29 × -134..11                 | Yellow lattice crane, boom to the upper left, hook plate                                                       |
| `orecart`        | -21..21 × -20..18                   | Red ore cart with purple ore                                                                                   |
| `conveyor`       | -3..183 × -12..12                   | Belt with rollers, left-end origin                                                                             |
| `dish`           | -144..144 × -144..144               | Huge dish with concentric rings, three feed arms, service platform (-104..104 × -58..88)                       |
| `satwing`        | -107..13 × -57..57                  | Solar wing on an orange bus box (hinge on the dish side)                                                       |
| `satellite`      | -227..227 × -144..144               | `dish` plus two mirrored `satwing`s                                                                            |
| `ringroadplanet` | -219..219 × -132..139               | Striped planet r 135, highway ring (rx 205 ry 42 at y 70) with rovers, dome plaza (-108..108 × -88..80)        |
| `commandship`    | -279..274 × -132..132               | Chunky starship pointing +x: cream hull, red engine pods with flames, teal bridge canopy (-150..180 × -82..82) |
| `comet`          | -128..604 × -128..128               | Comet moving -x: teal nucleus r 124 with an ice plateau, striped yellow/orange/red tail                        |
| `tug`            | -29..62 × -45..45                   | Red tug pod with a tow bar to +62 and two thrusters                                                            |
| `shuttle`        | -120..47 × -33..33                  | Small shuttle pointing +x with flame and two swooshes                                                          |
| `flightpath`     | 0..200 × -22..2                     | Dashed curve segment (scale/rotate at the `<use>`)                                                             |
| `wormhole`       | -150..150 (rings to ±99)            | Purple/teal concentric rings with a navy eye and a glow                                                        |
| `sun`            | -220..220 (disc r 82, rays to 150)  | Yellow sun with twelve chunky orange rays and a glow                                                           |
| `farplanet`      | -62..62 × -34..34                   | Small orange ringed planet                                                                                     |
| `nebula`         | ≈ -325..325 × -175..175             | Three candy blobs (pink, purple, teal) with outlines (scale/rotate at the `<use>`)                             |
| `sparkle`        | -14..14 × -14..14                   | Four-point star                                                                                                |

## Example layouts

Every example: root `data-ofis="1" data-canvas="…" data-avatar="small"`, then `<defs>`, `#backdrop`
(space, nebulae, the star pattern plus sparkles, the wormhole, the far planet, a sun peeking in from a
corner), `#rooms` with seven groups, and `#overlay` (dashed flight paths in the gaps between rooms,
three shuttles). Each room group starts with an **invisible** bounding rect (`fill="none"
stroke="none"`) computed from the structure's drawn extent plus 3 px, then the structure in a scaled
group, and ends with its `area-<cols>x<rows>` rect on the structure's calm deck. The generator asserts
the rects' minimum size, that they stay inside the canvas and never overlap, that every area is inside
its rect and below the control-bar strip, and that all four area corners lie on the calm deck.
The same seven-room set is used on every canvas except for the seventh workspace: the satellite on the
landscape, the ring road planet on the square, the comet on the portrait.

**Landscape** `galaxy-topdown-landscape.svg` (1920×1080, cells 90×120, areas ≥ 50 px below the rect top):

| Room (type)               | Structure (origin, scale)                              | Bounds (x y w h) | Area            | Deck under the area            |
| ------------------------- | ------------------------------------------------------ | ---------------- | --------------- | ------------------------------ |
| Launch pad (reception)    | `launchpad` 250,330 ×1 + rocket, gantry, two lamps     | 10 40 480 417    | 2×1 at 218,278  | inside the yellow landing ring |
| Saucer lounge (break)     | `saucer` 730,245 ×1                                    | 523 58 414 302   | 2×1 at 640,183  | inner saucer deck              |
| Ring station (workspace)  | `ringstation` 1200,245 ×1                              | 972 53 456 384   | 2×1 at 1110,185 | hub                            |
| Moon base (meeting)       | `moonbase` 1680,230 ×1                                 | 1488 58 384 364  | 2×1 at 1590,225 | paved apron                    |
| Asteroid mine (workspace) | `asteroid` 312,690 ×1.15 + rig, crane, carts, conveyor | 33 523 558 336   | 2×1 at 222,630  | worked terrace                 |
| Command ship (conference) | `commandship` 966,680 ×1.2                             | 628 518 670 324  | 3×1 at 849,620  | bridge canopy                  |
| Satellite (workspace)     | `satellite` 1615,700 ×1.2                              | 1339 524 552 352 | 2×1 at 1525,658 | dish service platform          |

**Square** `galaxy-topdown-square.svg` (1080×1080, cells 67.5×90, rects ≥ 237×136, areas ≥ 50 px below):

| Room (type)                  | Structure (origin, scale)                             | Bounds (x y w h) | Area               |
| ---------------------------- | ----------------------------------------------------- | ---------------- | ------------------ |
| Launch pad (reception)       | `launchpad` 200,240 ×0.75                             | 19 21 362 315    | 2×1 at 176,201     |
| Saucer lounge (break)        | `saucer` 830,190 ×0.75                                | 674 49 312 228   | 2×1 at 762.5,143.5 |
| Ring station (workspace)     | `ringstation` 225,480 ×0.7                            | 64 344 322 272   | 2×1 at 157.5,435   |
| Moon base (meeting)          | `moonbase` 840,488 ×0.7                               | 704 366 272 258  | 2×1 at 772.5,481.5 |
| Asteroid mine (workspace)    | `asteroid` 240,730 ×0.7 + rig, crane, carts, conveyor | 69 627 342 207   | 2×1 at 172.5,685   |
| Ring road planet (workspace) | `ringroadplanet` 840,730 ×0.7                         | 683 634 314 197  | 2×1 at 772.5,688.5 |
| Command ship (conference)    | `commandship` 560,945 ×0.75                           | 347 843 422 204  | 3×1 at 470,900     |

**Portrait** `galaxy-topdown-portrait.svg` (1080×1440, cells 90×120, rects ≥ 316×181, areas ≥ 70 px below):

| Room (type)               | Structure (origin, scale)                              | Bounds (x y w h) | Area             |
| ------------------------- | ------------------------------------------------------ | ---------------- | ---------------- |
| Launch pad (reception)    | `launchpad` 248,300 ×0.95                              | 19 24 458 397    | 2×1 at 213,247.5 |
| Saucer lounge (break)     | `saucer` 872,210 ×0.9                                  | 685 41 374 273   | 2×1 at 782,148   |
| Ring station (workspace)  | `ringstation` 250,650 ×1                               | 22 458 456 384   | 2×1 at 160,590   |
| Moon base (meeting)       | `moonbase` 895,630 ×0.85                               | 731 483 328 311  | 2×1 at 805,617   |
| Asteroid mine (workspace) | `asteroid` 245,1000 ×0.9 + rig, crane, carts, conveyor | 26 869 438 264   | 2×1 at 155,944.5 |
| Command ship (conference) | `commandship` 775,1000 ×1                              | 493 865 559 270  | 2×1 at 700,940   |
| Comet surf (workspace)    | `comet` 335,1302 ×1 + `tug`                            | 135 1171 807 262 | 2×1 at 245,1242  |

Bounding rects are tight to the art; the saucer's tractor beam is the only thing that reaches outside
its rect, into empty space above the next row. The dark files repeat the same geometry.
