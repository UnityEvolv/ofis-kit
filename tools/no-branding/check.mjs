/**
 * The engine carries no identity of its own, and this keeps it that way.
 *
 * A team self-hosting ofiskit is running *their* office, not our product. So
 * there is no header, no navigation, no product name, no logo, no favicon of
 * ours and no `Brand` component, and whoever hosts it decides what goes in the
 * browser tab. That is a boundary rule rather than a styling preference: it is
 * the smallest, most visible form of the lock-in this whole project exists to
 * argue against.
 *
 * It is also the rule most likely to be broken by accident and with good
 * intentions — a favicon looks like an oversight, an empty header looks
 * unfinished, and adding either feels like an improvement. Hence a check.
 *
 * unitykit itself stays: buttons, avatars, icons and tokens are shared
 * furniture. Only the parts that carry identity are refused.
 */
import { readFile, readdir } from 'node:fs/promises'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const SKIP = new Set(['node_modules', '.git', 'dist', 'dist-pages', 'coverage', 'test-results', 'playwright-report'])

/** File names that are brand assets whatever they contain. */
const FORBIDDEN_NAMES = [
  { pattern: /^favicon\./i, what: 'a favicon' },
  { pattern: /^apple-touch-icon/i, what: 'an iOS home-screen icon' },
  { pattern: /^og\.(png|jpe?g|webp)$/i, what: 'an open-graph image' },
  { pattern: /^manifest\.webmanifest$/i, what: 'a web app manifest naming the product' },
  { pattern: /(logo|wordmark)/i, what: 'a logo' },
  { pattern: /^maskable/i, what: 'an adaptive app icon' },
]

/** Extensions that only exist to be an application icon. */
const FORBIDDEN_EXTENSIONS = new Map([
  ['.icns', 'a macOS application icon'],
  ['.ico', 'a Windows application icon'],
])

/** What the kit exports that carries identity rather than furniture. */
const FORBIDDEN_IMPORTS = /\b(Brand|UEMark|UOMark)\b/

const problems = []

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const path = join(directory, entry.name)
    const where = relative(repo, path).split('\\').join('/')

    if (entry.isDirectory()) {
      if (entry.name === 'brand') {
        problems.push(`${where}/ — a brand folder. Brand assets live in the frontend repo, not here.`)
        continue
      }
      await walk(path)
      continue
    }

    for (const { pattern, what } of FORBIDDEN_NAMES) {
      if (pattern.test(entry.name)) problems.push(`${where} — ${what}.`)
    }

    const extension = FORBIDDEN_EXTENSIONS.get(extname(entry.name).toLowerCase())
    if (extension) problems.push(`${where} — ${extension}.`)

    // Only source files are read; this check is about what the app renders.
    if (!/\.(tsx?|jsx?|html)$/.test(entry.name)) continue
    // This file names the things it forbids, and the docs explain them.
    if (where.startsWith('tools/no-branding/')) continue

    const source = await readFile(path, 'utf8')

    for (const line of source.split('\n')) {
      if (line.includes('@unityevolv/unitykit') && FORBIDDEN_IMPORTS.test(line)) {
        problems.push(`${where} — imports the kit's Brand component. The engine has no identity of its own.`)
      }
    }

    if (/<link[^>]+rel=["'](icon|apple-touch-icon|manifest)/i.test(source)) {
      problems.push(`${where} — links an icon or a manifest. Whoever hosts this decides what goes in the tab.`)
    }
  }
}

await walk(repo)

if (problems.length > 0) {
  console.error('The engine has picked up an identity of its own:\n')
  for (const problem of problems) console.error(`  ${problem}`)
  console.error(
    '\nofiskit has no header, no logo, no favicon and no Brand component. A team\n' +
      'self-hosting it is running their office, not our product, and a wrapper that\n' +
      'wants a header adds its own. See docs/architecture.md.\n' +
      '\nBrand assets belong in the frontend repo, under UO-195.',
  )
  process.exit(1)
}

console.log('No branding in the engine: no logo, no favicon, no app icons, no Brand component.')
