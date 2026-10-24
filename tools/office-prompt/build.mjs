#!/usr/bin/env node
/**
 * Generate the copyable AI prompts for drawing an office as a structured SVG.
 *
 * One prompt per theme and view, assembled from the spec
 * (docs/office-svg/spec.json), the skeleton example and the theme's symbol
 * library under assets/<view>/<theme>/. Nothing in a prompt is written twice: a
 * rule changed in the spec reaches every prompt on the next build, and a test
 * fails if a committed prompt is stale.
 *
 *   node tools/office-prompt/build.mjs          write docs/office-svg/prompts/<theme>-<view>.md
 *   node tools/office-prompt/build.mjs --check  exit 1 if any committed prompt is stale
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SPEC = join(ROOT, 'docs', 'office-svg', 'spec.json')
const SKELETON = join(ROOT, 'docs', 'office-svg', 'skeleton.svg')
const ASSETS = join(ROOT, 'assets')
const OUT = join(ROOT, 'docs', 'office-svg', 'prompts')

/** Display names; a theme folder without one is shown by its id. */
const LABELS = { modern: 'Modern office', underwater: 'Underwater', galaxy: 'Galaxy' }

/** The two views, and how an office is composed in each. */
const VIEWS = {
  cut: {
    label: 'cutaway',
    how: [
      'The office is a building seen in cutaway, like a dollhouse with the front wall removed. Rooms sit on levels: rooms in one row share a y and a height, with a `<use href="#floor">` slab under the row in `#backdrop` and a `<use href="#pillar">` between neighbours in `#overlay`.',
      'Draw the building shell (roof, outer wall, plinth) and whatever is outside it in `#backdrop`. Each room group starts with its back-wall rect, then its furniture standing on the floor line.',
    ],
    notes: {
      floor: 'a level slab spanning the building, placed at the bottom of a row of rooms',
      pillar: 'a divider between two rooms on the same level; goes in #overlay',
      desk: 'a desk, surface clear; put a chair in front of it',
      chair: 'a chair, drawn from the front; its x is its centre',
      table: 'a long table for a meeting room; chairs along the front',
      cafe: 'a round café table on one stem; its x is its centre',
      stool: 'a stool for a café table; its x is its centre',
      sofa: 'a sofa for a lounge, library or café',
      bookshelf: 'a wall-standing shelf',
      whiteboard: 'wall-mounted',
      art: 'a wall picture',
      plant: 'a floor plant; its x is its centre, y its base',
      tallplant: 'a tall floor plant; its x is its centre, y its base',
      lamp: 'a hanging lamp with a glow; y is the ceiling',
      window: 'wall-mounted',
      counter: 'a reception counter',
      kitchen: 'a kitchen run for the break room',
      rug: 'a rug on the floor line; its x is its centre',
      clock: 'wall-mounted; its x, y is its centre',
    },
  },
  top: {
    label: 'top-down',
    how: [
      "The office is seen from directly above. Rooms are the floor areas; draw each room's floor as the bounds rect (a pattern fill of `#floor` works) with its walls as a stroke or a second rect, doors as gaps onto a corridor, windows along outer walls, and furniture from above with clear floor where the area rect sits.",
      'A room that is not rectangular (a round pod, a planet) still starts with a rect: an invisible one (`fill="none" stroke="none"`) that is its bounding box, followed by the shape itself.',
      'Whatever is outside the rooms (ground, corridors, water, space) goes in `#backdrop`; `#overlay` is optional.',
    ],
    notes: {
      floor: "a seamless floor tile, used as a pattern fill for a room's bounds rect",
      pillar: 'a column seen from above',
      desk: 'a desk from above; keep its surface clear',
      chair: 'a chair from above, backrest at the top',
      table: 'a long table from above; chairs along its sides',
      cafe: 'a round café table from above',
      stool: 'a stool from above',
      sofa: 'a sofa from above',
      bookshelf: 'a thin shelf, placed against a wall',
      whiteboard: 'a thin board, placed on a wall',
      art: 'a picture, placed on a wall',
      plant: 'a plant from above',
      tallplant: 'a bigger plant from above',
      lamp: 'a floor lamp with a glow',
      window: 'a glazing segment, placed on the wall line',
      counter: 'a reception counter from above',
      kitchen: 'a kitchen run, placed along a wall',
      rug: 'a rug; a good place for an area rect',
      clock: 'a wall clock',
    },
  },
}

/** Every theme that has a symbol library, per view. */
export function discoverThemes() {
  const found = []
  for (const view of Object.keys(VIEWS)) {
    const dir = join(ASSETS, view)
    if (!existsSync(dir)) continue
    for (const theme of readdirSync(dir).sort()) {
      const symbols = join(dir, theme, 'symbols-light.svg')
      if (existsSync(symbols)) {
        found.push({ id: `${theme}-${view}`, theme, view, label: LABELS[theme] ?? theme, symbols })
      }
    }
  }
  return found
}

/** The `<defs>…</defs>` block of a file, verbatim. */
function readDefs(file) {
  const source = readFileSync(file, 'utf8')
  const match = /<defs>[\s\S]*?<\/defs>/.exec(source)
  if (match === null) throw new Error(`${file} has no <defs>`)
  return match[0]
}

/** The symbol ids a defs block declares as `<g id="…">`. */
function symbolIds(defs) {
  return [...defs.matchAll(/<g id="([^"]+)"/g)].map((match) => match[1])
}

function bullet(items) {
  return items.map((item) => `- ${item}`).join('\n')
}

export function buildPrompt(entry, spec, skeleton) {
  const view = VIEWS[entry.view]
  const defs = readDefs(entry.symbols)
  const ids = symbolIds(defs)
  const canvases = Object.entries(spec.canvases)
    .map(([name, canvas]) => `${name} (${canvas.ratio}, viewBox="${canvas.viewBox}")`)
    .join(', ')
  const cells = Object.entries(spec.area.sizeInViewBoxPixels)
    .filter(([key]) => key !== 'note')
    .map(
      ([canvas, sizes]) =>
        `${canvas}: ${Object.entries(sizes)
          .map(([size, [w, h]]) => `${size} ${w}×${h}`)
          .join(', ')}`,
    )
  const refused = Object.entries(spec.safety.refusedElements)
    .map(([name, why]) => `${name === 'DOCTYPE' ? name : `<${name}>`} (${why})`)
    .join(', ')
  const symbols = ids
    .map((id) => `\`#${id}\`${view.notes[id] ? ` (${view.notes[id]})` : ''}`)
    .join(', ')

  return `# Draw an office: ${entry.label}, ${view.label}

<!-- Generated by tools/office-prompt/build.mjs from docs/office-svg/spec.json and assets/${entry.view}/${entry.theme}/. Do not edit; edit the spec or the symbols. -->

Copy everything below the line into your AI assistant, then describe the office you want. Paste the SVG it returns into the office builder. If the builder lists problems, paste the list back to the assistant and ask it to fix them.

---

You are drawing a virtual office as a single SVG file for a product that places people's avatars into rooms. Output one complete SVG and nothing else: no explanation, no markdown fence. Before you draw, ask me these and wait for my answers: how many people the office is for; which rooms I want and what they are called; landscape, square or portrait; light only, or light and dark.

## The structure (required)

The product reads the rooms out of the file, so the structure is a contract. Follow it exactly.

- Root: \`<svg xmlns="http://www.w3.org/2000/svg" viewBox="…" data-ofis="${spec.version}" data-canvas="…" data-avatar="small">\`. The viewBox is one of: ${canvases}. \`data-canvas\` names the one you used.
- Direct children, in order: \`<defs>\` (the symbols below, copied verbatim), \`<g id="backdrop">\` (${spec.groups.backdrop}), \`<g id="rooms">\` (${spec.groups.rooms}), and optionally \`<g id="overlay">\` (${spec.groups.overlay}).
- A room is \`<g id="room-<type>-<Name>" data-bar="top">\` inside \`#rooms\`. Type is one of ${spec.room.types.join(', ')}. Name is the room's display name with underscores for spaces, for example \`${spec.room.idExample}\`. \`data-bar\` is top or bottom: which edge the product's ${spec.limits.minRoomPixelsAtReference.barHeight}px control bar sits on. Keep that edge calm.
- The first \`<rect>\` inside a room group is the room's bounds, read from its x, y, width and height. Everything inside the room goes inside its group.
- Where people stand: \`<rect id="${spec.area.idExample}" x="…" y="…" width="…" height="…" fill="none"/>\` inside the room, ${spec.area.placement}. \`area-<columns>x<rows>\` says how many avatars fit. One cell in viewBox pixels: ${cells.join('; ')}. The area must be invisible (${spec.area.visibility}) and must lie inside the room, below the top ${spec.limits.minRoomPixelsAtReference.barHeight}px bar strip (or above the bottom one), clear of furniture that stands where people would.

## The rules (the product refuses a file that breaks one)

${bullet(spec.officeRules)}
- At most ${spec.limits.maxRooms} rooms. Every room at least ${spec.limits.minRoomPixelsAtReference.barMinWidth}px wide at a 1024px-wide viewport (about 315px on the landscape and portrait viewBoxes, 237px on the square one) and tall enough for the bar plus one cell.
- Allowed elements: ${spec.safety.allowedElements.join(', ')}.
- Refused: ${refused}.
${bullet(spec.safety.attributeRules)}

## How to draw (${view.label})

${bullet(view.how)}
${bullet(spec.drawingGuidance)}
- Place symbols with \`<use href="#id" x="…" y="…"/>\`. Do not redraw them; the theme is the symbols.

## The ${entry.label} symbols, ${view.label} (copy this \`<defs>\` block verbatim)

Available: ${symbols}.

\`\`\`svg
${defs}
\`\`\`

## A worked skeleton (two rooms; yours will have more)

\`\`\`svg
${skeleton.trim()}
\`\`\`

A complete example office drawn with these symbols is in the ofiskit repository at docs/office-svg/examples/${entry.theme}-${entry.view === 'cut' ? 'cutaway' : 'topdown'}-landscape.svg; edit from it rather than composing from nothing if you can read files.
`
}

export function buildAll() {
  const spec = JSON.parse(readFileSync(SPEC, 'utf8'))
  const skeleton = readFileSync(SKELETON, 'utf8')
  const out = {}
  for (const entry of discoverThemes()) {
    out[join(OUT, `${entry.id}.md`)] = buildPrompt(entry, spec, skeleton)
  }
  return out
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  const check = process.argv.includes('--check')
  const built = buildAll()
  let stale = 0
  for (const [file, content] of Object.entries(built)) {
    if (check) {
      const current = existsSync(file) ? readFileSync(file, 'utf8') : null
      if (current !== content) {
        stale += 1
        console.error(`stale: ${file} — run npm run office:prompt`)
      }
    } else {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, content)
      console.log(`wrote ${file}`)
    }
  }
  if (check && stale > 0) process.exit(1)
}
