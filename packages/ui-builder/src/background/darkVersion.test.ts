import { describe, expect, it } from 'vitest'

import { darkVersion } from './darkVersion.js'

/**
 * The same office after hours: what gets darker, what does not, and what must
 * never be touched.
 */

function lightness(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ]
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2
}

/** The one colour in a single-attribute snippet. */
function colourIn(svg: string): string {
  const found = /#[0-9a-f]{6}/i.exec(svg)?.[0]
  if (!found) throw new Error(`no colour in ${svg}`)
  return found
}

describe('the dark version of an office', () => {
  it('turns a pale wall into a dark surface', () => {
    const wall = colourIn(darkVersion('<rect fill="#fbf6ee"/>'))
    expect(lightness(wall)).toBeLessThan(0.25)
  })

  it('dims furniture without turning it into a wall', () => {
    const wall = lightness(colourIn(darkVersion('<rect fill="#fbf6ee"/>')))
    const sofa = lightness(colourIn(darkVersion('<rect fill="#d9884e"/>')))

    expect(sofa).toBeLessThan(lightness('#d9884e'))
    // A step above the walls, so a room's furniture still reads against them.
    expect(sofa).toBeGreaterThan(wall)
  })

  it('leaves the lights on', () => {
    expect(darkVersion('<path fill="#f4d35e"/>')).toBe('<path fill="#f4d35e"/>')
  })

  it('reads three-digit colours', () => {
    const paper = colourIn(darkVersion('<rect fill="#eee"/>'))
    expect(lightness(paper)).toBeLessThan(0.25)
  })

  it('keeps a white sheen white, and quieter', () => {
    expect(darkVersion('<rect fill="#fff" opacity="0.6"/>')).toBe(
      '<rect fill="#ffffff" opacity="0.21"/>',
    )
  })

  it('makes a shadow strong enough to show on a dark wall', () => {
    expect(darkVersion('<rect fill="#000" opacity="0.06"/>')).toBe(
      '<rect fill="#000000" opacity="0.18"/>',
    )
    expect(darkVersion('<feDropShadow flood-color="#5a4632" flood-opacity="0.22"/>')).toBe(
      '<feDropShadow flood-color="#000000" flood-opacity="0.44"/>',
    )
  })

  it('softens a glow, which at full strength reads as fog', () => {
    expect(darkVersion('<stop stop-color="#ffe7a8" stop-opacity="0.75"/>')).toBe(
      '<stop stop-color="#ffe7a8" stop-opacity="0.338"/>',
    )
  })

  it('never mistakes a reference to an element for a colour', () => {
    // "bed", "cafe" and "add" are all hex digits.
    const svg = '<use href="#bed"/><use xlink:href="#add"/><rect fill="url(#cafe)"/>'
    expect(darkVersion(svg)).toBe(svg)
  })

  it('changes colours and nothing else', () => {
    const svg =
      '<svg viewBox="0 0 1920 1080"><rect x="10" y="20" width="30" height="40" rx="4" fill="#e3ece2" stroke="#a9998a"/></svg>'
    const dark = darkVersion(svg)

    expect(dark.replace(/#[0-9a-f]{6}/gi, '#')).toBe(svg.replace(/#[0-9a-f]{6}/gi, '#'))
    expect(dark).not.toBe(svg)
  })

  it('recolours colours inside a style block too', () => {
    const dark = darkVersion('<style>.wall { fill: #f3ede3 }</style>')
    expect(lightness(colourIn(dark))).toBeLessThan(0.25)
  })
})
