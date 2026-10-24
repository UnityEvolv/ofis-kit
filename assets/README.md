# Office themes

The symbol libraries the office pictures are drawn from, one folder per view
and theme. The [spec](../docs/office-svg/spec.md) says how a picture is put
together; this folder is the art.

```
assets/
  cut/<theme>/            cutaway: rooms on levels, seen from the front
  top/<theme>/            top-down: a plan seen from above
    symbols/light/<id>.svg   ONE FILE PER SYMBOL — the source. Standalone, previews on its own
    symbols/dark/<id>.svg    the same symbol in the dark palette, identical geometry
    symbols/<mode>/_theme.svg  paints the theme uses outside any symbol (wall swatches, sky)
    symbols-light.svg        GENERATED bundle: every symbol in one <defs>, what a picture copies
    symbols-dark.svg         GENERATED
    CATALOG.md               GENERATED gallery of every symbol, light and dark, with sizes
    README.md                the theme: idea, palette, how it is composed
```

Edit or add a file under `symbols/<mode>/`, then `npm run office:assets` to
rebuild the bundles and the catalog, and `npm run office:prompt` to refresh the
AI prompts that carry the bundle. A test fails when either is stale.

Each symbol file is a complete SVG: a `viewBox` around the drawing, a `<defs>`
with only the gradients, filters and patterns that symbol uses, and the symbol
itself as a `<g id="…">`. Open it in a browser, a file manager or Figma to see
it. `data-bbox` on the root is the drawn box; the bundle and the catalog read it.

A theme ships every shared id in each view it exists in: `floor`, `pillar`,
`desk`, `chair`, `table`, `cafe`, `stool`, `sofa`, `bookshelf`, `whiteboard`,
`art`, `plant`, `tallplant`, `lamp`, `window`, `counter`, `kitchen`, `rug`,
`clock`. A theme may add its own. Light and dark hold the same ids with the same
geometry; only colours differ.

To split a hand-written bundle into symbol files (a one-time job, or after
someone edits a bundle directly): `npm run office:assets:split [assets/top/x]`.
It measures each symbol in a headless Chrome, so it runs locally, not in CI.
