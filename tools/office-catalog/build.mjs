#!/usr/bin/env node
/**
 * Build the catalog templates from the example offices.
 *
 * Every example under docs/office-svg/examples is a finished office drawn to
 * the convention, light and dark, in every canvas shape. Each becomes one
 * template, read out of its light SVG exactly as the builder would read it,
 * so what the catalog offers and what an author's own upload becomes cannot
 * differ. The office service ships these as its built-in catalog, published
 * from the first start, with the SVGs served by the realtime service.
 *
 *   node tools/office-catalog/build.mjs          write docs/office-svg/catalog/<theme>-<view>-<canvas>.json
 *   node tools/office-catalog/build.mjs --check  exit 1 if any committed template is stale
 *
 * Ids are deterministic, numbered per file, so a rebuild changes nothing
 * unless a picture did; a random id would make every build a diff.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const EXAMPLES = join(ROOT, 'docs', 'office-svg', 'examples')
const OUT = join(ROOT, 'docs', 'office-svg', 'catalog')
const TEMPLATE = join(ROOT, 'packages', 'template', 'dist', 'index.js')

/** Display names, as tools/office-prompt names them. */
const THEMES = { modern: 'Modern office', underwater: 'Underwater', galaxy: 'Galaxy' }
const VIEWS = { cutaway: 'cutaway', topdown: 'top-down' }
const CANVASES = { landscape: 'landscape', square: 'square', portrait: 'portrait' }

/** What each theme's office is, for the catalog card. */
const DESCRIPTIONS = {
  modern: 'A modern open-plan office: reception, a break room, workspaces and meeting rooms.',
  underwater: 'An office under the sea: reception, a break room, workspaces and meeting rooms.',
  galaxy: 'An office in deep space: reception, a break room, workspaces and meeting rooms.',
}

/** The engine's reader, from the built template package: the one the builder uses. */
async function engine() {
  if (!existsSync(TEMPLATE)) {
    throw new Error('Build @unityevolv/ofiskit-template first: npm run build -w packages/template')
  }
  return import(pathToFileURL(TEMPLATE).href)
}

/** Every catalog template, by the file it is written to. Throws on an example that is not a clean office. */
export async function buildAll() {
  const { readOfficeSvg, validateTemplate } = await engine()
  const out = {}
  for (const file of readdirSync(EXAMPLES).sort()) {
    const match = /^([a-z]+)-([a-z]+)-([a-z]+)\.svg$/.exec(file)
    if (!match) continue // the dark versions, and anything else
    const [, theme, view, canvas] = match
    if (!THEMES[theme] || !VIEWS[view] || !CANVASES[canvas]) {
      throw new Error(`${file}: not <theme>-<view>-<canvas>.svg`)
    }
    const id = `${theme}-${view}-${canvas}`
    const dark = `${id}-dark.svg`
    if (!existsSync(join(EXAMPLES, dark))) {
      throw new Error(`${file}: no dark version ${dark}`)
    }

    let counter = 0
    const read = readOfficeSvg(readFileSync(join(EXAMPLES, file), 'utf8'), {
      imageName: file,
      ids: () => `${id}-${++counter}`,
    })
    if (!read.marked || !read.template || read.issues.length > 0) {
      throw new Error(
        `${file}: not a clean office: ${read.issues.map((issue) => issue.message).join(' ')}`,
      )
    }
    const template = {
      ...read.template,
      name: `${THEMES[theme]}, ${VIEWS[view]}, ${CANVASES[canvas]}`,
      description: DESCRIPTIONS[theme],
      images: { light: file, dark },
    }
    const validated = validateTemplate(template)
    if (!validated.ok) {
      throw new Error(
        `${file}: the template is not valid: ${validated.issues.map((issue) => issue.message).join(' ')}`,
      )
    }
    out[join(OUT, `${id}.json`)] = JSON.stringify(template, null, 2) + '\n'
  }
  return out
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  const check = process.argv.includes('--check')
  const built = await buildAll()
  let stale = 0
  for (const [file, content] of Object.entries(built)) {
    if (check) {
      const current = existsSync(file) ? readFileSync(file, 'utf8') : null
      if (current !== content) {
        stale += 1
        console.error(`stale: ${file}`)
      }
    } else {
      mkdirSync(OUT, { recursive: true })
      writeFileSync(file, content)
      console.log(`wrote ${file}`)
    }
  }
  if (stale > 0) {
    console.error(`${stale} catalog template(s) are stale; run npm run office:catalog`)
    process.exit(1)
  }
}
