import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { TemplateError } from '../errors.js'
import { validateTemplate } from '../validate.js'
import { canvasForRatio, readOfficeSvg } from './office-svg.js'
import { checkSvgSafety } from './safety.js'
import { parseXml, XmlParseError } from './xml.js'

/** The worked examples shipped with the spec. Every one must import clean. */
const EXAMPLES = fileURLToPath(new URL('../../../../docs/office-svg/examples/', import.meta.url))

/** Stable ids, so a snapshot of an import does not change on every run. */
function counter() {
  let next = 0
  return () => `id-${(next += 1)}`
}

/** A minimal marked office: a reception and a break room, both big enough. */
function marked(body: string, root = 'data-ofis="1" data-canvas="landscape" data-avatar="small"') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" ${root}>
  <defs><g id="desk"><rect width="100" height="20"/></g></defs>
  <g id="backdrop"><rect width="1920" height="1080" fill="#eee"/></g>
  <g id="rooms">${body}</g>
</svg>`
}

const RECEPTION = `
    <g id="room-reception-Reception" data-bar="top">
      <rect x="100" y="600" width="600" height="400" fill="#fff"/>
      <use href="#desk" x="200" y="900"/>
      <rect id="area-4x1" x="200" y="700" width="360" height="120" fill="none"/>
    </g>`
const BREAK = `
    <g id="room-break-Cafe" data-bar="bottom">
      <rect x="1000" y="600" width="600" height="400" fill="#fff"/>
      <rect id="area-2x1" x="1100" y="700" width="180" height="120" fill="none"/>
    </g>`

function codes(result: { issues: { code: string }[] }): string[] {
  return result.issues.map((entry) => entry.code)
}

describe('the XML reader', () => {
  it('reads nesting, attributes and self-closing tags', () => {
    const root = parseXml(`<?xml version="1.0"?><!-- hi --><a x="1" y='two'><b/><c>text</c></a>`)
    expect(root.name).toBe('a')
    expect(root.attributes).toEqual({ x: '1', y: 'two' })
    expect(root.children.map((child) => child.name)).toEqual(['b', 'c'])
    expect(root.children[1]?.text).toBe('text')
  })

  it('decodes the predefined entities in attribute values', () => {
    const root = parseXml(`<a title="Tom &amp; Jerry &lt;3 &#x41;"/>`)
    expect(root.attributes['title']).toBe('Tom & Jerry <3 A')
  })

  it('refuses a DOCTYPE, which is how an XML file attacks its reader', () => {
    expect(() => parseXml(`<!DOCTYPE svg [<!ENTITY x "y">]><svg/>`)).toThrow(XmlParseError)
  })

  it('names the line of a mismatched tag', () => {
    expect(() => parseXml(`<svg>\n<g>\n</svg>`)).toThrow(/closes <g>.*line 3/)
  })
})

describe('the safety check', () => {
  const unsafe = (inner: string) =>
    checkSvgSafety(parseXml(`<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`))

  it('passes shapes, paint, symbols, filters and a style block', () => {
    expect(
      unsafe(
        `<defs><linearGradient id="g"><stop offset="0"/></linearGradient>
         <filter id="f"><feDropShadow dx="1"/></filter><g id="s"><rect/></g></defs>
         <style>.a{fill:url(#g)}</style>
         <use href="#s" filter="url(#f)"/><path d="M0 0"/>`,
      ),
    ).toEqual([])
  })

  it('refuses scripts, embedded documents, raster images and animation, each once', () => {
    const issues = unsafe(`<script/><script/><foreignObject/><image href="a.png"/><animate/>`)
    expect(issues.map((entry) => entry.fields?.['element'])).toEqual([
      'script',
      'foreignObject',
      'image',
      'animate',
    ])
    expect(issues.every((entry) => entry.code === TemplateError.SVG_UNSAFE)).toBe(true)
  })

  it('refuses event handlers and links to anywhere but an id', () => {
    const issues = unsafe(`<rect onclick="x()"/><use href="https://x/y.svg#a"/><use href="#ok"/>`)
    expect(issues.map((entry) => entry.fields?.['attribute'])).toEqual(['onclick', 'href'])
  })

  it('refuses CSS that reaches outside the file', () => {
    expect(unsafe(`<style>@import url(x.css);</style>`)).toHaveLength(1)
    expect(unsafe(`<rect style="fill:url(http://x/y)"/>`)).toHaveLength(1)
    expect(unsafe(`<rect style="fill:URL( 'x.png' )"/>`)).toHaveLength(1)
    expect(unsafe(`<rect style="fill:url(#g)"/>`)).toEqual([])
    expect(unsafe(`<rect style="fill:url( '#g' ); stroke:url(#h)"/>`)).toEqual([])
    // A long run of spaces inside url( must not make the check slow.
    const padded = `<style>.a{fill:url(${' '.repeat(50_000)}#g)}</style>`
    const started = Date.now()
    expect(unsafe(padded)).toEqual([])
    expect(Date.now() - started).toBeLessThan(500)
  })
})

describe('canvas detection', () => {
  it('maps the three ratios and refuses anything else', () => {
    expect(canvasForRatio(1920 / 1080)).toBe('landscape')
    expect(canvasForRatio(1)).toBe('square')
    expect(canvasForRatio(1080 / 1440)).toBe('portrait')
    expect(canvasForRatio(2)).toBeNull()
  })
})

describe('reading an office SVG', () => {
  it('treats a file without room groups as a plain picture', () => {
    const result = readOfficeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><rect width="1600" height="900"/></svg>`,
      { imageName: 'office-light.svg' },
    )
    expect(result.marked).toBe(false)
    expect(result.canvas).toBe('landscape')
    expect(result.template).toBeNull()
    expect(result.issues).toEqual([])
  })

  it('reads rooms, bars and areas from the groups and normalises them', () => {
    const result = readOfficeSvg(marked(RECEPTION + BREAK), {
      imageName: 'office-light.svg',
      ids: counter(),
    })
    expect(result.marked).toBe(true)
    expect(result.issues).toEqual([])
    expect(result.found).toEqual({ rooms: 2, areas: 2 })

    const template = result.template
    expect(template).not.toBeNull()
    if (template === null) return
    expect(template.canvas).toBe('landscape')
    expect(template.avatarSize).toBe('small')
    expect(template.images).toEqual({ light: 'office-light.svg' })

    const [reception, cafe] = template.rooms
    expect(reception).toMatchObject({
      id: 'id-2',
      name: 'Reception',
      type: 'reception',
      bar: 'top',
    })
    expect(reception?.rect).toEqual({
      x: 100 / 1920,
      y: 600 / 1080,
      width: 600 / 1920,
      height: 400 / 1080,
    })
    expect(reception?.areas).toEqual([
      { id: 'id-1', x: 200 / 1920, y: 700 / 1080, columns: 4, rows: 1 },
    ])
    expect(cafe).toMatchObject({ name: 'Cafe', type: 'break', bar: 'bottom' })

    // What comes out is a template the ordinary validator accepts as it is.
    expect(validateTemplate(template).ok).toBe(true)
  })

  it('turns underscores in a Figma layer name into spaces', () => {
    const result = readOfficeSvg(
      marked(RECEPTION.replace('room-reception-Reception', 'room-reception-Front_desk') + BREAK),
      { imageName: 'x.svg' },
    )
    expect(result.template?.rooms[0]?.name).toBe('Front desk')
  })

  it('reads rooms wherever they are nested, not only directly under #rooms', () => {
    const result = readOfficeSvg(marked(`<g id="Floor_1">${RECEPTION}</g>${BREAK}`), {
      imageName: 'x.svg',
    })
    expect(result.found.rooms).toBe(2)
    expect(result.issues).toEqual([])
  })

  it('still prefills the rooms when the office rules fail, so the builder can show where', () => {
    const twoReceptions = RECEPTION + RECEPTION.replace('Reception', 'Reception_2')
    const result = readOfficeSvg(marked(twoReceptions), { imageName: 'x.svg' })
    expect(result.template?.rooms).toHaveLength(2)
    expect(codes(result).sort()).toEqual(
      [
        TemplateError.ROOM_REQUIRED_MISSING,
        TemplateError.ROOM_REQUIRED_DUPLICATE,
        TemplateError.ROOM_OVERLAP,
        TemplateError.ROOM_OVERLAP,
      ].sort(),
    )
  })

  it('names a room group that has no bounds rect', () => {
    const noBounds = `<g id="room-reception-Reception"><use href="#desk"/></g>` + BREAK
    const result = readOfficeSvg(marked(noBounds), { imageName: 'x.svg' })
    expect(codes(result)).toContain(TemplateError.SVG_ROOM_BOUNDS_MISSING)
    expect(result.issues[0]?.message).toMatch(/Reception .*no bounds/)
  })

  it('refuses lettering once the file is an office', () => {
    const result = readOfficeSvg(marked(RECEPTION + BREAK + `<text x="1" y="2">RECEPTION</text>`), {
      imageName: 'x.svg',
    })
    expect(codes(result)).toEqual([TemplateError.SVG_TEXT])
    expect(result.issues[0]?.message).toContain('RECEPTION')
  })

  it('refuses an unknown room type and an unknown bar, naming the group', () => {
    const bad =
      RECEPTION.replace('room-reception-', 'room-lobby-') + BREAK.replace('bottom', 'left')
    const result = readOfficeSvg(marked(bad), { imageName: 'x.svg' })
    expect(codes(result)).toContain(TemplateError.ROOM_TYPE_UNKNOWN)
    expect(codes(result)).toContain(TemplateError.ROOM_BAR_UNKNOWN)
  })

  it('refuses a canvas that is not one of the three, and a data-canvas that disagrees', () => {
    const wrongRatio = marked(RECEPTION + BREAK).replace('0 0 1920 1080', '0 0 1920 500')
    expect(codes(readOfficeSvg(wrongRatio, { imageName: 'x.svg' }))).toContain(
      TemplateError.SVG_CANVAS_MISMATCH,
    )
    const disagrees = marked(RECEPTION + BREAK, 'data-ofis="1" data-canvas="square"')
    const result = readOfficeSvg(disagrees, { imageName: 'x.svg' })
    expect(codes(result)).toContain(TemplateError.SVG_CANVAS_MISMATCH)
    expect(result.canvas).toBeNull()
  })

  it('warns about a visible area marker and a missing avatar size, without refusing', () => {
    const visible = RECEPTION.replace('fill="none"', 'fill="#f00"') + BREAK
    const result = readOfficeSvg(marked(visible, 'data-ofis="1"'), { imageName: 'x.svg' })
    expect(result.issues).toEqual([])
    expect(result.warnings.map((entry) => entry.code)).toEqual([
      TemplateError.SVG_AVATAR_SIZE_MISSING,
      TemplateError.SVG_AREA_VISIBLE,
    ])
    expect(result.template?.avatarSize).toBe('medium')
  })

  it('refuses what cannot be read, with the line', () => {
    const result = readOfficeSvg(`<svg viewBox="0 0 16 9">\n<g>\n</svg>`, { imageName: 'x.svg' })
    expect(codes(result)).toEqual([TemplateError.SVG_MALFORMED])
    expect(result.issues[0]?.path).toBe('svg:line 3')
  })

  it('refuses a file over the size cap before reading it', () => {
    const huge = `<svg viewBox="0 0 16 9">${'<rect/>'.repeat(200_000)}</svg>`
    expect(codes(readOfficeSvg(huge, { imageName: 'x.svg' }))).toEqual([
      TemplateError.SVG_MALFORMED,
    ])
  })
})

describe('the worked examples', () => {
  const files = readdirSync(EXAMPLES).filter((name) => name.endsWith('.svg'))

  it('exist, in light and dark', () => {
    expect(files.length).toBeGreaterThan(0)
    for (const file of files.filter((name) => !name.endsWith('-dark.svg'))) {
      expect(files, `${file} needs a dark variant`).toContain(file.replace(/\.svg$/, '-dark.svg'))
    }
  })

  for (const file of files) {
    it(`${file} imports clean, every room with an area`, () => {
      const result = readOfficeSvg(readFileSync(join(EXAMPLES, file), 'utf8'), {
        imageName: file,
      })
      expect(result.marked).toBe(true)
      expect(result.issues).toEqual([])
      expect(result.warnings).toEqual([])
      // The file name says which canvas it was drawn for; the importer must agree.
      const [, canvas] = /-(landscape|square|portrait)(?:-dark)?\.svg$/.exec(file) ?? []
      expect(result.canvas).toBe(canvas)
      expect(result.found.rooms).toBeGreaterThanOrEqual(7)
      expect(result.found.areas).toBe(result.found.rooms)
      const types = result.template?.rooms.map((room) => room.type) ?? []
      expect(types.filter((type) => type === 'reception')).toHaveLength(1)
      expect(types.filter((type) => type === 'break')).toHaveLength(1)
    })
  }

  it('keep identical geometry between a light file and its dark variant', () => {
    for (const file of files.filter((name) => !name.endsWith('-dark.svg'))) {
      const dark = file.replace(/\.svg$/, '-dark.svg')
      const ids = counter()
      const light = readOfficeSvg(readFileSync(join(EXAMPLES, file), 'utf8'), {
        imageName: file,
        ids,
      })
      const other = readOfficeSvg(readFileSync(join(EXAMPLES, dark), 'utf8'), {
        imageName: dark,
        ids: counter(),
      })
      expect(other.template?.rooms, `${dark} differs from ${file}`).toEqual(light.template?.rooms)
    }
  })
})
