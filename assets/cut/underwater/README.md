# Underwater theme

A research habitat on the seabed, seen in cutaway like a dollhouse. The building is a riveted
hull with a glass dome on top; the rooms are pods with warm, calm back walls so avatars and name
labels read clearly against them. Outside the hull: deep-blue water with faint light rays from
above, a sandy seabed with rocks and kelp, and a few static bubble clusters. Nothing animates.

The theme uses the **same symbol ids and (almost) the same footprints as the Modern office**
(`docs/office-svg/examples/modern-cutaway-landscape*.svg`), so a template can swap themes by swapping the `<defs>`
block. `symbols-light.svg` / `symbols-dark.svg` hold every symbol inside `<defs>` and draw nothing
else; the two files have identical geometry and differ only in colours. A composed example lives in
`docs/office-svg/examples/underwater-cutaway-landscape.svg` (and `-dark.svg`).

Drawing rules kept: flat vector, gradients and the two `feDropShadow` filters (`#sh`, `#shS`),
no raster, no `<image>`, no `<text>`, no faces, no `<script>`/`<style>`, hrefs are `#id` only.

## Palette

| Role                                      | Light                                         | Dark                                          |
| ----------------------------------------- | --------------------------------------------- | --------------------------------------------- |
| Water (gradient top → bottom)             | `#1f5f8f` → `#5aa3c9`                         | `#061a2e` → `#0d3350`                         |
| Light rays                                | `#ffffff` @ 0.08                              | `#9fd0ff` @ 0.05                              |
| Sand / sand light / sand dark             | `#d9c39a` / `#ead9b6` / `#b9a27a`             | `#4a3f2f` / `#5a4d3a` / `#332b20`             |
| Hull / frame / rivet / rivet shade        | `#cfd6dc` / `#8a98a3` / `#eef3f6` / `#5f6d78` | `#3b4752` / `#1f272e` / `#6b7a86` / `#141a1f` |
| Pillar strut                              | `#b4c0c8`                                     | `#2a333b`                                     |
| Dome glass                                | `#bfe0f5` → `#e9f5fc`                         | `#15223a` → `#23334d`                         |
| Porthole glass `glassG`                   | `#2f7db0` → `#8fd0ea`                         | `#0b2a44` → `#1b5578`                         |
| Floor slab top (`floorTop`, horizontal)   | `#e6d3ab` → `#d4bd90`                         | `#5a4e3c` → `#6b5e4a`                         |
| Floor slab edge (`floorEdge`)             | `#a08c6b` → `#7f6d52`                         | `#4a4034` → `#352d24`                         |
| Wall `wTeal` (sea-glass teal)             | `#d8efe9` → `#bfe0d8`                         | `#1d3f3f` → `#27504e`                         |
| Wall `wSand` (pale sand)                  | `#f6ecd8` → `#eadcc0`                         | `#4a4030` → `#574b38`                         |
| Wall `wCoral` (coral pink)                | `#f9dcd6` → `#f0c6bd`                         | `#4e2f30` → `#5c3a3b`                         |
| Wall `wKelp` (kelp green)                 | `#dcebd4` → `#c6dcbc`                         | `#2b3f2c` → `#364d36`                         |
| Wall `wNavy` (deep navy)                  | `#c6d5e6` → `#aec2d8`                         | `#1c2a44` → `#253655`                         |
| Wall `wPearl` (pearl)                     | `#f4f1f6` → `#e5e0ea`                         | `#3a3a44` → `#464652`                         |
| Driftwood / dark / table / apron          | `#d9bf98` / `#b8976c` / `#e2cfae` / `#c7ab82` | `#6b5a44` / `#54452f` / `#6f5e45` / `#574a36` |
| Coral / coral light / coral dark          | `#e07a5f` / `#f0a08a` / `#c75f48`             | `#9d5e4e` / `#b57461` / `#7e4a3b`             |
| Shell / shell mid / shell dark            | `#f6e3d6` / `#edc9b8` / `#d9a893`             | `#c9ae9f` / `#a88a7b` / `#8c6f61`             |
| Metal / metal light / metal pale          | `#6f7f8c` / `#9fb0ba` / `#c4d0d8`             | `#4a5663` / `#5f6d78` / `#76858f`             |
| Sea-glass teal / dark                     | `#8ec9c0` / `#5fa39b`                         | `#4e8a82` / `#376a63`                         |
| Kelp greens                               | `#3f8a5b` `#5fb27b` `#6cc48a` `#2f6f48`       | `#2f6a46` `#3f8a5b` `#4da66c` `#244f36`       |
| Brass / brass dark                        | `#c9a24a` / `#a37f32`                         | `#a37f32` / `#7a5e24`                         |
| Slate board / chalk                       | `#3e4a50` / `#eef3f4`                         | `#1f2a30` / `#b9c6cc`                         |
| Jellyfish / tentacles / glow (`lampGlow`) | `#f7d9e8` / `#e9b9d2` / `#ffe7a8` @ 0.7       | `#c9a6b9` / `#a3869a` / `#ffc766` @ 0.3       |
| Rock light / dark                         | `#9aa5a9` / `#6f7c82`                         | `#4d5a62` / `#2f3a40`                         |
| Fish orange / fish pale                   | `#f4a261` / `#f2cc8f`                         | `#c77a3f` / `#b09562`                         |
| Pearl, mugs, dials                        | `#fdfaf3`                                     | `#d7dde1` / `#cfd6dc`                         |
| Air tank / tank dark                      | `#5aa3c9` / `#3f7fa3`                         | `#3f7fa3` / `#2a5c7a`                         |
| Bubbles                                   | `#ffffff` @ 0.7                               | `#cfe6f5` @ 0.5                               |
| Drop-shadow flood (`sh` / `shS`)          | `#1b3a4f` @ 0.22 / 0.25                       | `#000000` @ 0.44 / 0.5                        |

Patterns: `grate` (28×30 slot, laid over the slab top), `panel` (120×60 faint hull-panel seams,
laid over each room wall).

## Symbols

Footprints are the drawn extent relative to the symbol's own origin (x range × y range), so a
placement that fits Modern fits here. Origins match Modern: top-left for slabs, boards and
counters; the floor contact point for chairs, stools, plants and café tables; the cord top for the
lamp; the centre for the rug and clock.

| id           | Footprint (px)                                   | Underwater drawing                                              | Replaces in Modern                       |
| ------------ | ------------------------------------------------ | --------------------------------------------------------------- | ---------------------------------------- |
| `floor`      | 0..1720 × 0..44                                  | Sandstone ledge with grating slots and a lit top edge           | Wooden level slab                        |
| `pillar`     | 0..22 × 0..300                                   | Riveted steel strut                                             | Plaster column                           |
| `desk`       | 0..220 × -5..62                                  | Driftwood plank on coral-stone legs; flat shell and tablet only | Desk (items were up to -9)               |
| `chair`      | -19..19 × -22..30                                | Scallop-shell chair on a stem                                   | Office chair (-20..30)                   |
| `table`      | 0..340 × -5..62                                  | Long driftwood table on coral legs, one flat chart              | Meeting table (-8..62)                   |
| `cafe`       | -48..48 × -9..54                                 | Round top on a single metal stem                                | Café table                               |
| `stool`      | -13..13 × -8..30                                 | Coral dome stool                                                | Stool                                    |
| `sofa`       | -8..198 × -18..52                                | Clam-shell sofa with two cushions                               | Sofa                                     |
| `bookshelf`  | 0..150 × 0..150                                  | Coral shelf with bottles, shells, a jarred pearl, a starfish    | Bookshelf                                |
| `whiteboard` | 0..200 × 0..128                                  | Slate board in a driftwood frame, chalk lines                   | Whiteboard                               |
| `art`        | 0..160 × 0..110 (circle r=48 at 80,55)           | Brass porthole frame around a sunset picture                    | Framed art                               |
| `plant`      | -34..34 × -60..35                                | Kelp clump on a rock                                            | Potted plant (-36..36 × -60..36)         |
| `tallplant`  | -30..30 × -106..29                               | Tall kelp on a rock                                             | Tall plant (-46..46 × -108..30)          |
| `lamp`       | -26..26 × 0..80, glow ellipse -110..110 × 0..140 | Jellyfish lamp hanging from a cord                              | Pendant lamp (glow -120..120 × -20..140) |
| `window`     | 0..200 × 0..130                                  | Stadium porthole, thick riveted frame, two fish, bubbles        | Window                                   |
| `counter`    | 0..260 × -30..70                                 | Treasure-chest reception counter with brass bands and lock      | Reception counter                        |
| `kitchen`    | 0..300 × -34..60                                 | Steel counter with an air tank, pressure dial and two mugs      | Kitchen / coffee point                   |
| `rug`        | -150..150 × -10..10                              | Sand-ripple ellipse                                             | Rug                                      |
| `clock`      | -34..34 (rim r=24, handles to r=31)              | Ship's-wheel clock                                              | Wall clock (r=28)                        |
| `bubbles`    | 0..40 × 0..80                                    | Static cluster of five bubbles                                  | new                                      |
| `rock`       | 0..120 × 0..60                                   | Seabed boulder                                                  | new                                      |
| `anchor`     | 0..90 × 0..110                                   | Wall-hung anchor                                                | new                                      |

## Example layout

The example keeps Modern's room grid and the importer convention: root `data-ofis="1"`, then
`<defs>`, `#backdrop` (water, rays, seabed, hull, slabs at y=370/706, plinth at y=1040), `#rooms`
with nine `room-*` groups (first child = wall rect, last child = `area-<cols>x<rows>` rect), and
`#overlay` with six pillars. Wall swatches used: Workspace/Engineering teal, Open floor/Reception
sand, Library kelp, Studio/Café coral, Meeting navy, Quiet room pearl.
