/**
 * Prove that the kit's classes actually generated CSS.
 *
 * This guards the single most likely thing to go wrong when wiring unitykit into
 * an app, and the reason it needs a check rather than a code review is that it
 * fails **silently**. Tailwind does not scan `node_modules` when it looks for
 * class names, so a kit component renders with all its classes present in the
 * markup and no CSS behind any of them. No error, no warning, nothing in the
 * console — just an unstyled page that looks like the components are broken.
 *
 * The `@source` directive in the stylesheet is the fix. This is how we find out
 * if somebody removes it, or points it somewhere that quietly resolves to
 * nothing — which is what happens when a path assumes the packages are under
 * `app/node_modules` and npm has hoisted them to the root instead.
 *
 * Run it after building the app.
 */
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const assets = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'app', 'dist', 'assets')

/**
 * Classes that can only come from scanning the kit inside node_modules.
 *
 * Deliberately not classes the app's own source uses: those generate whether
 * the source directives work or not, so they would prove nothing. These come
 * from the kit's compiled components, which is exactly the scan that silently
 * does not happen when an @source path is wrong.
 */
const EXPECTED = [
  // daisyUI component classes, from the kit's own components.
  { class: 'btn', from: 'unitykit' },
  { class: 'input', from: 'unitykit' },
]

const files = await readdir(assets).catch(() => {
  console.error('app/dist/assets is not there. Build the app first.')
  process.exit(1)
})

const stylesheets = files.filter((file) => file.endsWith('.css'))
if (stylesheets.length === 0) {
  console.error('The build produced no stylesheet at all.')
  process.exit(1)
}

let css = ''
for (const sheet of stylesheets) css += await readFile(join(assets, sheet), 'utf8')

const missing = EXPECTED.filter(({ class: name }) => !css.includes(`.${name}`))

if (missing.length > 0) {
  console.error('The kit rendered, but its CSS was never generated.\n')
  for (const { class: name, from } of missing) {
    console.error(`  .${name}  (expected from ${from})`)
  }
  console.error(
    '\nTailwind does not scan node_modules for class names, so this fails silently:\n' +
      'components keep their classes and lose their styles. Check the @source lines\n' +
      'in app/src/styles.css actually resolve — npm hoists workspace packages to the\n' +
      'repository root, not to app/node_modules.',
  )
  process.exit(1)
}

console.log(
  `The kit's classes are in the stylesheet (${Math.round(css.length / 1024)} kB from ${stylesheets.length} file${stylesheets.length === 1 ? '' : 's'}).`,
)
