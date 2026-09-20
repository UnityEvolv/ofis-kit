/**
 * A size budget per entry point, so a careless import cannot quietly double the app.
 *
 * The number that matters is what a browser downloads, so everything here is
 * measured gzipped. A budget that counts uncompressed bytes reports a number
 * nobody experiences and moves for reasons nobody cares about.
 *
 * When this fails, the fix is almost never to raise the number. Look at what
 * arrived: a provider SDK that escaped its adapter, a date library pulled in for
 * one format call, or the whole of the kit imported where one component was
 * wanted. Raising the budget is a decision to be argued for in the pull request,
 * not a way to make the check quiet.
 */
import { gzipSync } from 'node:zlib'
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const distDir = join(here, '..', '..', 'app', 'dist')

/**
 * Budgets in gzipped kilobytes, matched against a built file name.
 *
 * One budget per entry point. The builder has its own because it is a separate
 * download on purpose: somebody entering the office does not pay for a drawing
 * tool they have not opened, and somebody opening the builder does not download
 * the office. If those two ever merge, the shell budget is what notices.
 */
const BUDGETS = [
  { name: 'the app shell and the office', match: /^assets\/index-[\w-]+\.js$/, kb: 260 },
  { name: 'the builder, loaded on demand', match: /^assets\/builder-[\w-]+\.js$/, kb: 60 },
  { name: 'styles', match: /^assets\/index-[\w-]+\.css$/, kb: 40 },
]

/** Everything not matched above, together, so nothing hides by being unnamed. */
const TOTAL_KB = 400

async function walk(dir, base = '') {
  const found = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) found.push(...(await walk(join(dir, entry.name), rel)))
    else found.push(rel)
  }
  return found
}

const kb = (bytes) => Math.round((bytes / 1024) * 10) / 10

async function main() {
  const exists = await stat(distDir).catch(() => null)
  if (!exists) {
    console.error('app/dist is not built. Run `npm run build` first.')
    process.exitCode = 1
    return
  }

  const files = (await walk(distDir)).filter((file) => /\.(js|css)$/.test(file))
  const sizes = new Map()
  for (const file of files) {
    sizes.set(file, gzipSync(await readFile(join(distDir, file))).length)
  }

  const failures = []
  const matched = new Set()

  for (const budget of BUDGETS) {
    const hits = files.filter((file) => budget.match.test(file))
    if (hits.length === 0) {
      // A budget with nothing behind it is a budget that stopped being checked
      // when someone renamed a chunk, which is worse than no budget at all.
      failures.push(`No file matched the budget for ${budget.name} (${budget.match}).`)
      continue
    }
    const total = hits.reduce((sum, file) => sum + (sizes.get(file) ?? 0), 0)
    for (const hit of hits) matched.add(hit)
    const over = total > budget.kb * 1024
    console.log(
      `${over ? 'FAIL' : ' ok '}  ${String(kb(total)).padStart(7)} kB  / ${String(budget.kb).padStart(4)} kB  ${budget.name}`,
    )
    if (over) {
      failures.push(
        `${budget.name} is ${kb(total)} kB gzipped, over its ${budget.kb} kB budget: ${hits.join(', ')}.`,
      )
    }
  }

  const totalBytes = [...sizes.values()].reduce((sum, size) => sum + size, 0)
  const totalOver = totalBytes > TOTAL_KB * 1024
  console.log(
    `${totalOver ? 'FAIL' : ' ok '}  ${String(kb(totalBytes)).padStart(7)} kB  / ${String(TOTAL_KB).padStart(4)} kB  everything, gzipped`,
  )
  if (totalOver) {
    failures.push(`The whole app is ${kb(totalBytes)} kB gzipped, over its ${TOTAL_KB} kB budget.`)
  }

  const unmatched = files.filter((file) => !matched.has(file) && /\.js$/.test(file))
  if (unmatched.length > 0) {
    console.log(`\nOther chunks (inside the total, not separately budgeted):`)
    for (const file of unmatched.sort((a, b) => (sizes.get(b) ?? 0) - (sizes.get(a) ?? 0))) {
      console.log(`       ${String(kb(sizes.get(file) ?? 0)).padStart(7)} kB  ${file}`)
    }
  }

  if (failures.length > 0) {
    console.error('\nBundle budget failed:')
    for (const failure of failures) console.error(`  - ${failure}`)
    console.error(
      '\nBefore raising a number, find out what arrived. A provider SDK outside its adapter,\n' +
        'or a whole library imported for one function, is the usual answer.',
    )
    process.exitCode = 1
  }
}

await main()
