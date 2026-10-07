import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readAmbienceManifest } from './ambienceManifest.js'

const url = (name: string) => `/office/${name}`

describe('the ambience manifest', () => {
  it('lists the loops this app ships, each with where it came from and its licence', () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), 'config', 'ambience', 'manifest.json'), 'utf8'),
    ) as { tracks: Array<Record<string, unknown>> }

    const tracks = readAmbienceManifest(manifest, url)
    expect(tracks.length).toBeGreaterThan(0)
    expect(tracks).toHaveLength(manifest.tracks.length)
    for (const entry of manifest.tracks) {
      expect(entry.sourceUrl, String(entry.id)).toMatch(/^https:\/\//)
      expect(entry.licence, String(entry.id)).toBe('CC0-1.0')
    }
    expect(tracks[0]?.src).toMatch(/^\/office\/ambience\/[\w.-]+\.mp3$/)
  })

  it('keeps only well-formed entries', () => {
    const tracks = readAmbienceManifest(
      {
        tracks: [
          { id: 'cafe', label: 'Café', file: 'cafe.mp3' },
          { id: 'Bad Id', label: 'Bad', file: 'bad.mp3' },
          { id: 'none', label: 'None', file: 'none.mp3' },
          { id: 'escape', label: 'Escape', file: '../../secret.mp3' },
          { id: 'hidden', label: 'Hidden', file: '..' },
          { id: 'nolabel', file: 'x.mp3' },
        ],
      },
      url,
    )
    expect(tracks).toEqual([{ id: 'cafe', label: 'Café', src: '/office/ambience/cafe.mp3' }])
  })

  it('is empty for anything that is not a manifest', () => {
    expect(readAmbienceManifest(null, url)).toEqual([])
    expect(readAmbienceManifest({ tracks: 'no' }, url)).toEqual([])
  })
})
