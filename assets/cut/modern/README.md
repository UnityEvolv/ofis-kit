# Modern office theme

A city office block seen in cutaway, like a dollhouse: a plaster shell with a dark cornice and
plinth, wooden level slabs, and rooms painted in soft pastel washes so avatars and name labels read
clearly against them. Outside the shell: a pale sky gradient and a faint distant skyline. Flat
vector, two drop-shadow filters (`#sh`, `#shS`), no raster, no `<image>`, no `<text>`, no
animation, hrefs are `#id` only.

`symbols-light.svg` / `symbols-dark.svg` hold every symbol, gradient, pattern and filter inside
`<defs>` and draw nothing else. They are the `<defs>` blocks of
`docs/office-svg/examples/modern-cutaway-landscape.svg` and its `-dark` twin, copied verbatim; the
two have identical geometry and differ only in colours. The composed examples are
`modern-cutaway-{landscape,square,portrait}.svg` (+ `-dark`) in that folder. The Underwater theme
(`../underwater/`) draws the same symbol ids at the same footprints, so a template swaps themes by
swapping the `<defs>` block.

## Palette

| Role                                     | Light                                                                           | Dark                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Sky `sky` (top → bottom)                 | `#cfe3f3` → `#f3ede3`                                                           | `#0e1628` → `#1c2336`                                                           |
| Skyline (body, @ 0.6)                    | `#b9cbd8`                                                                       | `#1f2a3d`                                                                       |
| Shell fill / stroke (body)               | `#efe7db` / `#a9998a`                                                           | `#4c4233` / `#837a71`                                                           |
| Cornice and plinth (body)                | `#8d8172`, highlight `#fff` @ 0.4                                               | `#6f675d`, highlight `#fff` @ 0.14                                              |
| Floor slab top `floorTop` (horizontal)   | `#e2cdb0` → `#d1b58f`, lip `#fff` @ 0.5                                         | `#695841` → `#7e6c53`, lip `#fff` @ 0.175                                       |
| Floor slab edge `floorEdge`              | `#a8896a` → `#8c6f52`                                                           | `#866e55` → `#6d5945`                                                           |
| Floor shade strip (body)                 | `#000` @ 0.06                                                                   | `#000` @ 0.25                                                                   |
| Wall `wCream`                            | `#fbf6ee` → `#efe6d8`                                                           | `#433724` → `#4e4433`                                                           |
| Wall `wSage`                             | `#e3ece2` → `#cfddcf`                                                           | `#394437` → `#455245`                                                           |
| Wall `wBlue`                             | `#e4edf6` → `#cfdfee`                                                           | `#2b3948` → `#344555`                                                           |
| Wall `wTerra`                            | `#f6e4d7` → `#ecd1bf`                                                           | `#523b2b` → `#604737`                                                           |
| Wall `wPlum`                             | `#ece3f0` → `#dccde3`                                                           | `#403345` → `#4d3f54`                                                           |
| Wall `wYellow`                           | `#fbf1d6` → `#f3e2b4`                                                           | `#564824` → `#695a31`                                                           |
| Wall `brick` (pattern) mortar / brick    | `#e8d6c8` / `#ddc4b1`                                                           | `#59483a` / `#685446`                                                           |
| `wallpaper` dot (pattern)                | `#000` @ 0.05                                                                   | `#fff` @ 0.03                                                                   |
| Glass `glassG`                           | `#bfe0f5` → `#e9f5fc`                                                           | `#15223a` → `#23334d`                                                           |
| Window frame / buildings behind          | `#dfe6ea` / `#9db7c9`                                                           | `#394247` / `#34465e`                                                           |
| Sun `sunGlow` / lamp `lampGlow`          | `#ffffff` @ 0.55 / `#ffe7a8` @ 0.75                                             | `#dfe8ff` @ 0.35 / `#ffc766` @ 0.32                                             |
| Pillar                                   | `#d8cfc2`                                                                       | `#5b5449`                                                                       |
| Desk top / apron / legs                  | `#f1e5d3` / `#c9b08e` / `#5c4a3a`                                               | `#534531` / `#7f6f59` / `#483b30`                                               |
| Table top / apron                        | `#e6d2b7` / `#b89a75`                                                           | `#65543d` / `#997c58`                                                           |
| Chair (back, seat, frame, stem)          | `#4d5d73` `#5f7089` `#3b4a5c` `#6b7a8c`                                         | `#404b5a` `#4f5a6b` `#313b48` `#58626e`                                         |
| Sofa and stool orange (base, back, arms) | `#d9884e` / `#e69a63` / `#c97840`                                               | `#b76b35` / `#9b6b48` / `#9c6138`                                               |
| Sofa cushions                            | `#f2c9a1` / `#7fb7a3`                                                           | `#755435` / `#688a7e`                                                           |
| Bookshelf frame / shelf back             | `#a37c5f` / `#7a5a44`                                                           | `#7f6450` / `#5e493a`                                                           |
| Accents (books, desk items, board marks) | `#e07a5f` `#3d405b` `#81b29a` `#f2cc8f` `#8fa9c9` `#f4d35e` `#f2b880` `#7fb7e6` | `#9d5e4e` `#333547` `#6b897a` `#806437` `#596a7e` `#f4d35e` `#89613a` `#8cc4f0` |
| Whiteboard / clock / art face            | `#ffffff`                                                                       | `#2b2b2b`                                                                       |
| Whiteboard frame / art frame / clock rim | `#c9d3da` / `#d9cbb8` / `#3d405b`                                               | `#475056` / `#635849` / `#333547`                                               |
| Plant greens                             | `#4f9a6a` `#5fb27b` `#3f8a5b` `#6cc48a`                                         | `#447756` `#4d8e63` `#376a4a` `#4da66c`                                         |
| Pot / pot rim / tall-plant pot           | `#b96e4b` / `#d8875f` / `#8a7a66`                                               | `#8f5a41` / `#9d6c54` / `#6c6154`                                               |
| Counter body / top / front / monitor     | `#7a5a44` / `#b58c6b` / `#6a4c38` / `#3f4f60`                                   | `#5e493a` / `#947053` / `#523d30` / `#343f4b`                                   |
| Kitchen steel (body, top, doors)         | `#b0bec5` `#cfd8dc` `#78909c` `#90a4ae` `#455a64`                               | `#596368` `#464e51` `#60737d` `#6d797f` `#39474e`                               |
| Mugs                                     | `#eceff1`                                                                       | `#34393c`                                                                       |
| Rug (outer @ 0.55 / inner @ 0.7)         | `#c96f4f` / `#e9c9a0`                                                           | `#a2583e` / `#745c3d`                                                           |
| Drop-shadow flood (`sh` / `shS`)         | `#5a4632` @ 0.22 / 0.25                                                         | `#000000` @ 0.44 / 0.5                                                          |

## Symbols

Footprints are the drawn extent relative to the symbol's own origin (x range × y range). Origins:
top-left for slabs, boards, the window, counter and kitchen; the floor contact point for chairs,
stools, plants and the café table; the cord top for the lamp; the centre for the rug and clock.
Floor-standing pieces (desk, chair, table, cafe, stool, sofa, plant, tallplant, counter) sit with
their lowest point on the room's bottom edge; user areas must stay clear of them. Wall pieces
(window, art, whiteboard, bookshelf, kitchen, lamp, clock, rug) may sit behind an area.

| id           | Footprint (px)                               | What it is                                                                                                           |
| ------------ | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `floor`      | 0..1720 × 0..44                              | Wooden level slab at the landscape shell width (square and portrait draw slabs as rects with `floorTop`/`floorEdge`) |
| `pillar`     | 0..22 × 0..300                               | Plaster column between rooms                                                                                         |
| `desk`       | 0..220 × -9..62                              | Desk with a notebook, laptop and phone on top                                                                        |
| `chair`      | -19..19 × -20..30                            | Office chair on a stem                                                                                               |
| `table`      | 0..340 × -8..62                              | Long meeting table with a runner                                                                                     |
| `cafe`       | -48..48 × -9..54                             | Round café table on a single stem                                                                                    |
| `stool`      | -13..13 × -8..30                             | Orange bar stool                                                                                                     |
| `sofa`       | -8..198 × -18..52                            | Orange two-seat sofa with two cushions                                                                               |
| `bookshelf`  | 0..150 × 0..150                              | Three-shelf bookcase with books, a box and a plant                                                                   |
| `whiteboard` | 0..200 × 0..128                              | Whiteboard with three lines and a circle, pen tray beneath                                                           |
| `art`        | 0..160 × 0..110                              | Empty framed picture (draw the picture inside it in the room)                                                        |
| `plant`      | -36..36 × -60..36                            | Potted bush                                                                                                          |
| `tallplant`  | -46..46 × -108..30                           | Tall leafy plant in a pot                                                                                            |
| `lamp`       | -26..26 × -20..16, glow -120..120 × -20..140 | Pendant lamp with a soft radial glow                                                                                 |
| `window`     | 0..200 × 0..130 (stroke adds 4 on each side) | Four-pane window with the city and a sun behind it                                                                   |
| `counter`    | 0..260 × -30..70                             | Reception counter with a monitor, a bell and a card                                                                  |
| `kitchen`    | 0..300 × -34..60                             | Steel kitchen counter with a coffee machine and two mugs                                                             |
| `rug`        | -150..150 × -10..10                          | Oval rug                                                                                                             |
| `clock`      | r=28 (+2.5 stroke), centred                  | Wall clock                                                                                                           |

## Example layouts

Every example keeps the importer convention: root `data-ofis="1"`, then `<defs>`, `#backdrop`
(sky, skyline, shell, cornice, slabs, plinth), `#rooms` with `room-<type>-<Name>` groups (first
child = wall rect, last child = `area-<cols>x<rows>` rect), and `#overlay` with the pillars.

- **Landscape** (1920×1080): three levels, 3 / 3 / 3 rooms, shell at x 100..1820, pillars in 22 px
  gaps between rooms.
- **Square** (1080×1080): three levels at the landscape's heights (y 70 / 406 / 742), 3 / 2 / 3
  rooms, shell at x 50..1030, pillars in 22 px gaps. Cells are 67.5×90.
- **Portrait** (1080×1440): four levels 300 px tall with 44 px slabs (y 70 / 414 / 758 / 1102),
  2 / 3 / 2 / 2 rooms (adds Quiet room), shell at x 50..1030. Three 316 px rooms plus two 22 px
  gaps do not fit in 980 px, so rooms share their edges and the overlay pillars straddle the seams.
  Cells are 90×120.
