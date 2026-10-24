# Office SVG: the authoring spec

An office picture that carries its own rooms. When an SVG follows this
convention the builder reads the rooms and user areas straight out of it, so
the author's remaining job is to check the areas and publish. When it does not,
the file is a picture like any other and the rooms are drawn over it by hand.
Nothing is refused for lacking the markers.

Version **1**. The importer is `readOfficeSvg` in `@unityevolv/ofiskit-template`;
the machine-readable rules are in [spec.json](spec.json); worked examples are in
[examples/](examples/), and every one is a test fixture, so the examples can
never drift from what the importer accepts.

Who this is for: a designer exporting from Figma, a language model writing SVG
from the [published prompt](prompts/), and anyone checking a file by hand. The
[designer guide](designer-guide.md) is the short version.

## The shape of the file

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"
     data-ofis="1" data-canvas="landscape" data-avatar="small">
  <defs>…symbols, gradients, filters…</defs>

  <g id="backdrop">…sky, ground, the building shell, floor slabs…</g>

  <g id="rooms">
    <g id="room-reception-Reception" data-bar="top">
      <rect x="100" y="742" width="500" height="298" fill="url(#wall)"/>   <!-- bounds -->
      <use href="#counter" x="140" y="970"/>
      …
      <rect id="area-4x1" x="192" y="832" width="360" height="120" fill="none"/>
    </g>
    <g id="room-break-Cafe" data-bar="top">…</g>
    <g id="room-meeting-Design_studio" data-bar="bottom">…</g>
  </g>

  <g id="overlay">…pillars between rooms, anything above them…</g>
</svg>
```

## The root

| Attribute     | Value                               | Required                                   |
| ------------- | ----------------------------------- | ------------------------------------------ |
| `viewBox`     | one of the three canvases below     | yes (or `width` and `height`)              |
| `data-ofis`   | `1`                                 | recommended; says the file is an office    |
| `data-canvas` | `landscape`, `square` or `portrait` | recommended; must agree with the viewBox   |
| `data-avatar` | `small`, `medium` or `large`        | recommended; `medium` is assumed if absent |
| `data-name`   | the template's name                 | optional                                   |

The canvas is detected from the viewBox ratio with a 3% tolerance, the same
tolerance the builder applies to an uploaded raster. A picture that is none of
the three is refused: rooms would sit slightly wrong against it.

| Canvas    | Ratio | viewBox         |
| --------- | ----- | --------------- |
| landscape | 16:9  | `0 0 1920 1080` |
| square    | 1:1   | `0 0 1080 1080` |
| portrait  | 3:4   | `0 0 1080 1440` |

## Rooms

A room is a `<g>` whose id is `room-<type>-<Name>`:

- `type` is one of `reception`, `break`, `workspace`, `meeting`, `conference`.
- `Name` is the room's display name. Underscores are spaces, because that is
  how Figma writes a layer name into an id: `room-meeting-Design_studio` is
  "Design studio". Figma's duplicate suffix (`_2`) simply becomes part of the
  name ("Design studio 2") and the uniqueness rule catches real duplicates.
- `data-bar` is `top` or `bottom`: which edge the room's control bar sits on.
  Default `top`. Put it on whichever edge has the calmer art.

**The first `<rect>` directly inside the group is the room's bounds.** Its
`x`, `y`, `width`, `height` in viewBox units become the room's rectangle. In a
Figma export that is the frame's background fill, which comes first on its own.
A room group with no rect is refused with the room named.

Room groups are found wherever they are nested, so grouping rooms by floor
(`<g id="Floor_1">…`) is fine. Everything else inside a room group is art and is
not interpreted.

**A room that is not a rectangle** (a round pod, a planet in the Galaxy theme)
still starts with a rect: an invisible one, `fill="none" stroke="none"`, that is
the shape's bounding box. The shape itself follows. The product's hit area and
control bar use the box; the drawing can be anything inside it.

## User areas

An area is a `<rect>` inside the room group whose id is `area-<columns>x<rows>`.
Only its `x` and `y` are read: they are the area's top-left corner. The size is
derived from the template's avatar size, so an author cannot draw an area the
engine disagrees with. Draw it at the right size anyway so the furniture is
placed around it; the cell sizes in viewBox pixels are in
[spec.json](spec.json) (`area.sizeInViewBoxPixels`), for example 90×120 per
cell on a landscape canvas with small avatars.

An area must be invisible in the picture: `fill="none"` and no stroke. The
decisions page is explicit that user areas are "marked by nothing"; the
furniture makes them obvious. A visible marker is a warning, not a refusal.

Areas are optional. A room without one gets a centred area in the builder, as
a room drawn by hand does.

## The office rules

Once a file has room groups, it is an office, and the ordinary template rules
apply, exactly as they do to a template drawn in the builder:

- Exactly one reception and exactly one break room.
- Room names unique within the file.
- Rooms inside the canvas and not overlapping.
- Every room at least the control bar's width (168 px at a 1024×768 viewport)
  wide, and the bar plus one avatar cell tall.
- Every area inside its room, clear of the bar edge and of other areas.
- **No lettering.** `<text>` is refused. The product draws every room name on
  the room's bar; a name painted into the picture would be wrong the moment an
  org renames the room.
- **No animation.** Office pictures are still.
- The dark variant has identical structure and geometry; only colours differ.
  The importer compares the two and refuses a dark file whose rooms moved.

A file with problems still opens in the builder with its rooms prefilled, and
each problem is shown on the room it belongs to. Nothing is silently fixed.

## Safety

The picture is shown to every member of the office, so it is untrusted even
when staff drew it. The allow-list is in [spec.json](spec.json): shapes, paint,
gradients, patterns, clip paths, masks, symbols and `<use>`, and the filter
primitives a flat illustration uses. Refused, each with its reason named:
`<script>`, `<foreignObject>`, `<image>`, `<a>`, every `animate*` element, a
DOCTYPE, `on*` attributes, any `href` that is not `#an-id`, and CSS that uses
`url()` to anything but an id or `@import`. A refused element is reported, never
stripped: an author told what was wrong fixes the file; one whose file was
quietly altered ships something they have not seen.

Size cap: 1 MB. A drawn office is tens of kilobytes.

## Views and themes

An office is drawn in one of two **views**, and a theme is drawn per view:

| View             | Folder                | What a room is                                                                                                    | Rows                                                                                  |
| ---------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| cutaway (`cut`)  | `assets/cut/<theme>/` | a back wall on a level, furniture on the floor line                                                               | rooms in a row share a level; `#floor` slabs under rows, `#pillar` between neighbours |
| top-down (`top`) | `assets/top/<theme>/` | a floor seen from above with walls, doors and furniture; or a round pod or planet inside an invisible bounds rect | none; corridors, water or space between rooms                                         |

A **theme** is a set of symbols (`<g id="desk">`, `<g id="chair">`, …) plus a
palette, in a light and a dark version with identical geometry. The source is
one standalone file per symbol, `assets/<view>/<theme>/symbols/<mode>/<id>.svg`,
so each asset previews on its own; `symbols-light.svg` and `symbols-dark.svg`
(the `<defs>` bundle a picture copies) and `CATALOG.md` (a gallery) are
generated from them by `npm run office:assets`. See [assets/README.md](../../assets/README.md). A template places symbols with
`<use href="#desk" x y/>`; swapping the `<defs>` for another theme's in the same
view redraws the same office in that theme. Symbol ids are shared across themes
for that reason, and each theme draws every one of the shared set: `floor`,
`pillar`, `desk`, `chair`, `table`, `cafe`, `stool`, `sofa`, `bookshelf`,
`whiteboard`, `art`, `plant`, `tallplant`, `lamp`, `window`, `counter`,
`kitchen`, `rug`, `clock`. A theme may add its own.

The prompt generator discovers every `assets/<view>/<theme>/` folder, so adding
a theme is adding a folder and running `npm run office:prompt`.

## What the importer returns

```ts
readOfficeSvg(source, { imageName: 'office-light.svg' })
// { marked, canvas, template, found: { rooms, areas }, issues, warnings }
```

`marked: false` means "a picture; draw the rooms". `template` is prefilled
whenever the file was readable, even with `issues` outstanding. Every issue has
a stable `code`, a `path` that names the room group or line, and a message
written to be pasted back to whoever or whatever drew the file.

## Checking a file

`npm test` runs every example through the importer. To check your own file,
drop it on the builder's background step: it reports exactly what an import
would, without saving anything.
