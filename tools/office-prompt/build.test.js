import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { buildAll } from './build.mjs'

/**
 * The committed prompts are generated. A prompt that disagrees with the spec is
 * worse than no prompt, because an author follows it and is then refused.
 */
describe('the office prompts', () => {
  const built = buildAll()

  it('exist for every theme whose symbols are present', () => {
    expect(Object.keys(built).length).toBeGreaterThan(0)
  })

  for (const [file, content] of Object.entries(built)) {
    it(`${file.replace(/.*[\\/]/, '')} is up to date (npm run office:prompt)`, () => {
      expect(existsSync(file), `${file} is missing`).toBe(true)
      expect(readFileSync(file, 'utf8')).toBe(content)
    })

    it(`${file.replace(/.*[\\/]/, '')} carries the structure, the rules and the symbols`, () => {
      expect(content).toMatch(/^# Draw an office: .+, (cutaway|top-down)/)
      expect(content).toContain('data-ofis="1"')
      expect(content).toContain('room-<type>-<Name>')
      expect(content).toContain('area-<columns>x<rows>')
      expect(content).toContain('Exactly one reception')
      expect(content).toContain('<defs>')
      expect(content).toContain('<g id="desk"')
      // The rules mention `<text>` by name; the symbols must not contain one.
      expect(content).not.toMatch(/<text\s/)
    })
  }
})
