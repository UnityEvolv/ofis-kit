# Galaxy theme (cutaway): a cartoon mothership in cross-section

A toy-like space mothership cut open at the front like a dollhouse. The hull is a cream capsule
with a sloping bridge superstructure, a red-banded nosecone and antennae on top, riveted deck slabs
stacked inside, bulkhead struts between the compartments, red fins on the flanks and engine bells
with concentric flames underneath (or on side pylons on the landscape canvas). Outside the hull:
blue-violet space with a star field, candy nebulae peeking round the shoulders, a far ringed planet,
a comet and a few asteroids.

**The station's own kit is the furniture.** The reception is a docking bay with a parked shuttle,
a docking console and an airlock; the break room is an observation deck with big portholes, a
lounge pod and a galley; the meeting room is the bridge with the holo table and holo board; the
workspaces are a lab (crystals, teleporter pad, data rack), engineering (robot arm, crates, fuel
tank), crew quarters (lounge pod, hologram frame), a cargo hold and a workshop. At most a couple of
consoles per room; no rows of desks.

The style, not any licensed design: thick rounded navy outlines (6-8 px on the big shapes, 3-4 px
on the small ones, round joins), flat saturated fills with one lighter highlight band and one
darker shadow band, chunky rounded proportions, portholes with a white glint and a planet outside,
four-point sparkle stars, candy nebula blobs with outlines, flames drawn as concentric shapes.
No faces, no text, no animation.

Every room keeps a **calm back wall** (a flat pastel panel with faint seams) behind its user area,
and the top ~45 px of every room, where the product draws its control bar, is kept plain: wall
items start at 46 px or lower and only the lamp cord crosses the band.

`symbols-light.svg` / `symbols-dark.svg` hold every symbol inside `<defs>` and draw nothing else;
the two files have identical ids and geometry and differ only in colours. The composed examples are
`docs/office-svg/examples/galaxy-cutaway-{landscape,square,portrait}.svg` (and `-dark.svg`); all
eight files come from one script with two palettes, so their room geometry is identical by
construction.

Drawing rules kept: flat vector, three linear gradients (`space`, `portG` porthole glass, `teleG`
teleporter beam), three radial glows (`lampGlow`, `beaconGlow`, `tealGlow`), one `feDropShadow`
filter (`#sh`, the hull), three patterns (`stars` 128 px tile, `seam` faint wall panel seams,
`hazard` yellow/navy stripe), no raster, no `<image>`, no `<text>`, no `<script>`/`<style>`, no
animation, hrefs are `#id` only.

## Palette

Light Galaxy is a bright blue-violet space with pastel room walls; dark Galaxy is deep navy with
dark muted walls and stronger glows. The fills are the same bold primaries in both, a touch deeper
in dark.

| Role                                 | Light                                         | Dark                                          |
| ------------------------------------ | --------------------------------------------- | --------------------------------------------- |
| Space (gradient `space`, top → down) | `#3a3f8a` → `#2b2f6b` → `#232860`             | `#141a44` → `#0b0e2a` → `#070a1f`             |
| Outline ink                          | `#1b1f3a`                                     | `#0a0c22`                                     |
| Stars (opacity)                      | `#ffffff` (.9)                                | `#ffffff` (1)                                 |
| Hull shell / hi / lo                 | `#f4f1ea` / `#ffffff` / `#d9d4c8`             | `#e6e2d7` / `#f7f5ef` / `#c3beb0`             |
| Hull interior / lo                   | `#9aa3c4` / `#7d86a8`                         | `#4a5178` / `#3a4060`                         |
| Deck slab / hi / edge / light strip  | `#b9c1d9` / `#e4e8f3` / `#8b94b3` / `#8fe9f2` | `#8a92b4` / `#b4bbd6` / `#5b6386` / `#7fdde8` |
| Wall `wCream`                        | `#efe9dc`                                     | `#3d3a4d`                                     |
| Wall `wTeal`                         | `#d4eef1`                                     | `#243f4b`                                     |
| Wall `wPurple`                       | `#e3dcf4`                                     | `#352c57`                                     |
| Wall `wLime`                         | `#e2f1d3`                                     | `#2c3f2e`                                     |
| Wall `wYellow`                       | `#f9efcf`                                     | `#44402a`                                     |
| Wall `wBlue`                         | `#dde3f2`                                     | `#2b3254`                                     |
| Wall seams / floor shade (opacity)   | `#1b1f3a` (.07) / `#1b1f3a` (.08)             | `#ffffff` (.05) / `#000000` (.2)              |
| Cream / hi / lo                      | `#f4f1ea` / `#ffffff` / `#d9d4c8`             | `#e6e2d7` / `#f7f5ef` / `#c3beb0`             |
| Rocket red / hi / lo                 | `#e8423f` / `#ff7a6e` / `#b52f2d`             | `#d93a37` / `#f36d62` / `#9a2826`             |
| Lime / hi / lo                       | `#8fd14f` / `#c2ef8a` / `#5f9e2c`             | `#7fc443` / `#b3e37c` / `#4f8a24`             |
| Purple / hi / lo                     | `#7a4fd6` / `#a98af0` / `#55339e`             | `#6c43c7` / `#9b7ae6` / `#482a8c`             |
| Teal / hi / lo                       | `#27c3d6` / `#8fe9f2` / `#178e9e`             | `#22b4c7` / `#7fdde8` / `#137e8d`             |
| Yellow / hi / lo                     | `#ffd23f` / `#ffe98f` / `#d9a712`             | `#f5c62f` / `#ffe27a` / `#c7960c`             |
| Orange / hi / lo                     | `#ff8c42` / `#ffb27a` / `#c9601f`             | `#f07e36` / `#ffa96c` / `#b85417`             |
| Metal grey / hi / lo                 | `#b9c1d9` / `#e4e8f3` / `#8b94b3`             | `#a3abc8` / `#d2d7e8` / `#737c9d`             |
| Rock / hi / lo                       | `#b8794b` / `#e0a877` / `#86532f`             | `#a66b40` / `#cf9868` / `#744526`             |
| Holo panel (opacity) / holo lines    | `#27c3d6` (.32) / `#ffffff`                   | `#22b4c7` (.4) / `#ffffff`                    |
| Porthole glass (gradient `portG`)    | `#3a3f8a` → `#232860`                         | `#141a44` → `#070a1f`                         |
| Nebula A / B / C (fill op, ink op)   | `#ff7bc0` / `#8d6cf0` / `#39d6e8` (.5, .55)   | `#f25fae` / `#7a58e6` / `#2bc3d8` (.62, .7)   |
| Flame outer / mid / core             | `#ffd23f` / `#ff8c42` / `#ffffff`             | `#f5c62f` / `#f07e36` / `#ffffff`             |
| Lamp and beacon glow (opacity)       | `#ffd23f` (.5)                                | `#ffb833` (.6)                                |
| Teleporter beam (opacity, bottom)    | `#27c3d6` (.45)                               | `#22b4c7` (.55)                               |
| Drop shadow (`sh`)                   | `#000000` @ .3                                | `#000000` @ .5                                |

## Symbols

Footprints are the drawn extent relative to the symbol's own origin (x range × y range), outlines
included. Origins follow Modern so a placement that fits Modern fits here: top-left for the slab,
pillar, desk, table, rack, board, frame, window, counter, galley, airlock and crate; the floor
contact point for the chair (30 above the floor), stool (30), cafe table (54), sofa (52), plant (36),
tall plant (30), shuttle (10), teleporter (12) and the bottom centre for the robot arm, fuel tank
and the hull pieces; the cord top for the lamp; the centre for the rug, clock and space decor.

### Shared ids (every cutaway theme draws these)

| id           | Footprint (px)                             | Galaxy drawing                                                           |
| ------------ | ------------------------------------------ | ------------------------------------------------------------------------ |
| `floor`      | 0..1720 × 0..44                            | Riveted deck slab, lit top edge with a teal light strip, dark lip        |
| `pillar`     | -2..24 × 0..300                            | Bulkhead strut with cap and base plates, four rivets                     |
| `desk`       | 0..220 × -32..62                           | Console desk: cream top, raised teal screen, red and yellow buttons      |
| `chair`      | -19..19 × -27..30                          | Purple pod seat on a stem and base plate                                 |
| `table`      | 0..340 × -38..62                           | Holo table: projector disc with a tiny ringed-planet hologram            |
| `cafe`       | -48..48 × -9..54                           | Round holo table on a single stem                                        |
| `stool`      | -14..14 × -9..30                           | Purple pod stool                                                         |
| `sofa`       | -10..200 × -20..62                         | Lounge pod: red capsule, two cream cushions, bolster ends                |
| `bookshelf`  | 0..150 × 0..150                            | Data rack: four blade rows with lights and coloured bars                 |
| `whiteboard` | 0..200 × 0..128                            | Holo board: two emitter posts, translucent teal panel, chart             |
| `art`        | 0..160 × 0..110                            | Hologram frame showing a ringed orange planet and a sparkle              |
| `plant`      | -30..30 × -60..36                          | Crystal cluster in a rock pot (purple, teal)                             |
| `tallplant`  | -32..32 × -110..30                         | Tall crystal cluster                                                     |
| `lamp`       | -26..26 × 0..68, glow -110..110 × -20..140 | Beacon lamp: cord, metal cap, yellow dome, warm glow                     |
| `window`     | 0..200 × 0..130                            | Stadium porthole, riveted metal rim, space with a lime planet, moon      |
| `counter`    | 0..260 × 0..100                            | Docking console: orange block, three teal screens, buttons, slider       |
| `kitchen`    | 0..300 × 0..94                             | Galley: steel counter, two hob rings, drawer, purple dispenser, two mugs |
| `rug`        | -150..150 × -10..10                        | Landing-pad stripe: grey slab, yellow chevrons, red end lights           |
| `clock`      | -31..31 × -31..31                          | Chrono dial r=28, metal rim, cream face, red centre                      |

### Structure and decor

| id           | Footprint (px)          | Drawing                                                                         |
| ------------ | ----------------------- | ------------------------------------------------------------------------------- |
| `nosecone`   | -96..96 × -72..0        | Cream dome cap with a red band, porthole and rivets (origin bottom centre)      |
| `antenna`    | -18..18 × -92..0        | Mast with two crossbars and a glowing red tip light                             |
| `engine`     | -42..42 × 0..128        | Engine bell (mount at the origin) with a red band and a three-layer flame       |
| `fin`        | -100..0 × 0..150        | Swept red fin, attachment edge at x=0 pointing left (mirror with `scale(-1 1)`) |
| `shuttle`    | -106..97 × -100..10     | Parked shuttle pointing +x: cream body, red nose, teal canopy, tail fin, skids  |
| `robotarm`   | -32..132 × -142..0      | Orange two-segment arm on a pedestal, yellow joints, gripper reaching +x        |
| `crate`      | 0..64 × 0..56           | Orange cargo crate with a band, label and a lime light                          |
| `fueltank`   | -32..32 × -116..0       | Lime cylinder with a yellow hazard band, cap and gauge                          |
| `teleporter` | -72..72 × -124..14      | Metal pad with a teal disc, translucent beam column and a top ring              |
| `airlock`    | 0..120 × 0..170         | Riveted door with a porthole, yellow wheel, lights and hazard stripe            |
| `sparkle`    | -14..14 × -14..14       | Four-point star                                                                 |
| `nebula`     | ≈ -300..300 × -150..150 | Three candy blobs (pink, purple, teal) with outlines, scale at the `<use>`      |
| `farplanet`  | -62..62 × -34..34       | Small purple ringed planet                                                      |
| `asteroid`   | -62..62 × -58..50       | Potato rock with craters                                                        |
| `comet`      | -26..160 × -26..26      | Teal nucleus moving -x with a yellow/orange tail                                |

## Example layout

Root `data-ofis="1" data-canvas="…" data-avatar="small"`, then `<defs>` (a self-contained copy of
the symbols), `#backdrop` (space, stars, nebulae, planet, comet, asteroids, sparkles, the hull shell
and interior, shoulder portholes, fins, engines, nosecone and antennae, then a deck slab under every
deck: `<use href="#floor">` on landscape, the same drawing as a 980 px rect on square and portrait),
`#rooms`, and `#overlay` with a `#pillar` between neighbours on every deck (scaled to the deck
height). Each room group starts with its back-wall rect, then the seam pattern and a floor shade,
the furniture `<use>`s, and ends with its `area-<cols>x<rows>` rect on the floor line, clear of
every floor-standing piece.

| Canvas    | Hull (inner) | Decks (rooms)                                                                                                                       |
| --------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| landscape | 100..1820    | 80/286: Bridge, Observation deck, Crew quarters · 410/290: Lab, Engineering · 744/290: Docking bay, Cargo hold                      |
| square    | 50..1030     | 74/256: Bridge, Observation deck · 374/256: Lab, Engineering · 674/276: Docking bay, Cargo hold, Crew quarters                      |
| portrait  | 50..1030     | 84/270: Bridge, Observation deck · 398/280: Lab, Engineering · 722/280: Crew quarters, Workshop · 1046/280: Docking bay, Cargo hold |

The top deck sits inside the sloping bridge superstructure, so its rooms are inset from the hull
sides; the sloped hull faces either side of it carry small portholes. Areas start 60 px below the
room top on landscape, 50 on square and 70 on portrait, and the dark file repeats the same geometry.
