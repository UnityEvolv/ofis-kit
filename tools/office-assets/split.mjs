#!/usr/bin/env node
/**
 * Split a theme's symbol bundle into one file per symbol.
 *
 * A one-time migration, and the tool to reach for when a bundle has been
 * edited by hand: it reads `symbols-<mode>.svg`, measures every symbol in a
 * headless Chrome, and writes `symbols/<mode>/<id>.svg` — each a standalone
 * SVG that previews on its own, carrying exactly the gradients, filters and
 * patterns that symbol uses. Defs no symbol uses (wall swatches, the sky) go to
 * `symbols/<mode>/_theme.svg`. After that, `build.mjs` regenerates the bundle
 * from the split files, and the split files are the source.
 *
 *   node tools/office-assets/split.mjs                 every library under assets/
 *   node tools/office-assets/split.mjs assets/top/galaxy
 *   CHROME=<path> to point at a browser; the default is the Windows install.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { listLibraries, MODES } from './build.mjs'
import { parseXml, referencedIds } from './xml.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

/** Room around a symbol's box in its preview, so shadows and glows are not cut off. */
const PADDING = 12

/** Measure every `<g id>` in a bundle's defs with `getBBox`, through Chrome. */
function measure(bundleSource, ids) {
  const html = `<!doctype html><meta charset="utf-8"><body>
${bundleSource}
<svg id="stage" xmlns="http://www.w3.org/2000/svg" width="4000" height="4000"></svg>
<pre id="out"></pre>
<script>
  const out = {};
  const stage = document.getElementById('stage');
  for (const id of ${JSON.stringify(ids)}) {
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#' + id);
    stage.appendChild(use);
    try { const b = use.getBBox(); out[id] = [b.x, b.y, b.width, b.height]; } catch (e) { out[id] = null; }
    stage.removeChild(use);
  }
  document.getElementById('out').textContent = JSON.stringify(out);
</script></body>`
  const file = join(tmpdir(), `ofiskit-measure-${process.pid}.html`)
  writeFileSync(file, html)
  const dom = execFileSync(
    CHROME,
    ['--headless=new', '--disable-gpu', '--no-sandbox', '--dump-dom', pathToFileURL(file).href],
    { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
  )
  const match = /<pre id="out">([\s\S]*?)<\/pre>/.exec(dom)
  if (match === null) throw new Error('Chrome did not report the measurements.')
  return JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'))
}

function round(value) {
  return Math.round(value * 100) / 100
}

/** Split one library in one mode. Returns the symbol ids written. */
export function splitBundle(dir, mode) {
  const bundleFile = join(dir, `symbols-${mode}.svg`)
  const source = readFileSync(bundleFile, 'utf8')
  const root = parseXml(source)
  const defs = root.children.find((child) => child.name === 'defs')
  if (defs === undefined) throw new Error(`${bundleFile} has no <defs>`)

  const byId = new Map()
  const unnamed = []
  for (const child of defs.children) {
    const id = child.attributes['id']
    if (id === undefined) unnamed.push(child)
    else byId.set(id, child)
  }
  const text = (element) => source.slice(element.start, element.end)

  /** Every def an element needs, transitively, in bundle order. */
  const closure = (element) => {
    const needed = new Set()
    const queue = [...referencedIds(text(element))]
    while (queue.length > 0) {
      const id = queue.shift()
      if (needed.has(id) || !byId.has(id)) continue
      needed.add(id)
      queue.push(...referencedIds(text(byId.get(id))))
    }
    return [...byId.keys()].filter((id) => needed.has(id))
  }

  const symbolIds = [...byId.entries()]
    .filter(([, element]) => element.name === 'g')
    .map(([id]) => id)
  const boxes = measure(source, symbolIds)

  const outDir = join(dir, 'symbols', mode)
  mkdirSync(outDir, { recursive: true })

  const usedByAnySymbol = new Set()
  for (const id of symbolIds) {
    const element = byId.get(id)
    const deps = closure(element).filter((dep) => dep !== id)
    for (const dep of deps) usedByAnySymbol.add(dep)
    const box = boxes[id]
    if (box === null || box === undefined || box[2] === 0) {
      console.warn(`${basename(dir)}/${mode}/${id}: no box measured; using 200x200`)
    }
    const [x, y, w, h] = box && box[2] > 0 ? box : [0, 0, 200, 200]
    const viewBox = [x - PADDING, y - PADDING, w + 2 * PADDING, h + 2 * PADDING].map(round)
    const bbox = [x, y, w, h].map(round)
    const parts = [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.join(' ')}" width="${viewBox[2]}" height="${viewBox[3]}" data-symbol="${id}" data-bbox="${bbox.join(' ')}">`,
    ]
    if (deps.length > 0) {
      parts.push('  <defs>')
      for (const dep of deps) parts.push(`    ${text(byId.get(dep))}`)
      parts.push('  </defs>')
    }
    parts.push(`  ${text(element)}`)
    parts.push('</svg>', '')
    writeFileSync(join(outDir, `${id}.svg`), parts.join('\n'))
  }

  // What no symbol references belongs to the theme as a whole: wall swatches,
  // the sky, the wallpaper pattern. They ride along in one defs-only file.
  const themeDefs = [...byId.entries()]
    .filter(([id, element]) => element.name !== 'g' && !usedByAnySymbol.has(id))
    .map(([, element]) => text(element))
  for (const element of unnamed) themeDefs.push(text(element))
  const themeFile = join(outDir, '_theme.svg')
  if (themeDefs.length > 0) {
    writeFileSync(
      themeFile,
      [
        `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" data-theme-defs="${mode}">`,
        '  <defs>',
        ...themeDefs.map((entry) => `    ${entry}`),
        '  </defs>',
        '</svg>',
        '',
      ].join('\n'),
    )
  } else if (existsSync(themeFile)) {
    writeFileSync(themeFile, '')
  }

  return symbolIds
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  const wanted = process.argv.slice(2).map((arg) => resolve(ROOT, arg))
  const libraries = listLibraries().filter(
    (library) => wanted.length === 0 || wanted.includes(resolve(library.dir)),
  )
  for (const library of libraries) {
    for (const mode of MODES) {
      if (!existsSync(join(library.dir, `symbols-${mode}.svg`))) continue
      const ids = splitBundle(library.dir, mode)
      console.log(`${library.view}/${library.theme} ${mode}: ${ids.length} symbols`)
    }
  }
}
