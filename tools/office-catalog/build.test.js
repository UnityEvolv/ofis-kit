import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { buildAll } from './build.mjs'

/**
 * The committed catalog templates are generated from the example offices. One
 * that disagrees with its picture puts every room of a new office wrong, in
 * every org, from the first start of the office service.
 */
describe('the catalog templates', async () => {
  const built = await buildAll()

  it('exist for every example office, in every canvas shape', () => {
    const files = Object.keys(built).map((file) => file.replace(/.*[\\/]/, ''))
    expect(files.length).toBeGreaterThanOrEqual(18)
    for (const theme of ['modern', 'underwater', 'galaxy']) {
      for (const view of ['cutaway', 'topdown']) {
        for (const canvas of ['landscape', 'square', 'portrait']) {
          expect(files).toContain(`${theme}-${view}-${canvas}.json`)
        }
      }
    }
  })

  for (const [file, content] of Object.entries(built)) {
    const name = file.replace(/.*[\\/]/, '')
    it(`${name} is up to date (npm run office:catalog)`, () => {
      expect(existsSync(file), `${file} is missing`).toBe(true)
      expect(readFileSync(file, 'utf8')).toBe(content)
    })

    it(`${name} is a template the office service would publish`, () => {
      const template = JSON.parse(content)
      expect(template.version).toBe(1)
      expect(['landscape', 'square', 'portrait']).toContain(template.canvas)
      expect(template.name).toMatch(/^(Modern office|Underwater|Galaxy), (cutaway|top-down), /)
      expect(template.description).toMatch(/reception/)
      expect(template.images.light).toBe(name.replace(/\.json$/, '.svg'))
      expect(template.images.dark).toBe(name.replace(/\.json$/, '-dark.svg'))
      const types = template.rooms.map((room) => room.type)
      expect(types.filter((type) => type === 'reception')).toHaveLength(1)
      expect(types.filter((type) => type === 'break')).toHaveLength(1)
      expect(template.rooms.length).toBeGreaterThanOrEqual(3)
      // Every room has somewhere to sit, and ids are deterministic.
      for (const room of template.rooms) {
        expect(room.areas.length).toBeGreaterThan(0)
        expect(room.id).toMatch(new RegExp(`^${name.replace(/\.json$/, '')}-\\d+$`))
      }
    })
  }
})
