import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildAll, checkSelfContained, listLibraries, MODES } from './build.mjs'

/**
 * The per-symbol files are the source; the bundles and catalogs are generated.
 * A bundle that disagrees with its files would put a symbol in the prompt that
 * no designer can find, which is the whole thing the split exists to prevent.
 */
describe('the symbol libraries', () => {
  const libraries = listLibraries().filter((library) =>
    existsSync(join(library.dir, 'symbols', 'light')),
  )

  it('exist', () => {
    expect(libraries.length).toBeGreaterThan(0)
  })

  for (const library of libraries) {
    const name = `${library.view}/${library.theme}`

    it(`${name}: every split file is self-contained`, () => {
      for (const mode of MODES) {
        const dir = join(library.dir, 'symbols', mode)
        for (const file of readdirSync(dir).filter((entry) => entry.endsWith('.svg'))) {
          if (file.startsWith('_')) continue
          expect(checkSelfContained(join(dir, file)), `${name}/${mode}/${file}`).toEqual([])
          expect(readFileSync(join(dir, file), 'utf8'), `${name}/${mode}/${file}`).not.toMatch(
            /<text[\s>]|<script|<image|<animate/,
          )
        }
      }
    })

    it(`${name}: light and dark hold the same symbols`, () => {
      const ids = (mode) =>
        readdirSync(join(library.dir, 'symbols', mode))
          .filter((entry) => entry.endsWith('.svg'))
          .sort()
      expect(ids('dark')).toEqual(ids('light'))
    })
  }

  for (const [file, content] of Object.entries(buildAll())) {
    it(`${file.replace(/.*assets[\\/]/, '')} is up to date (npm run office:assets)`, () => {
      expect(existsSync(file), `${file} is missing`).toBe(true)
      expect(readFileSync(file, 'utf8')).toBe(content)
    })
  }
})
