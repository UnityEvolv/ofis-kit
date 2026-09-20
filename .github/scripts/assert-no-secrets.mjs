/**
 * Prove that a pull request cannot see a secret.
 *
 * This is the load-bearing claim of a public repository: a stranger forks it,
 * opens a pull request, and their code runs on our CI. If any of that has access
 * to a token, the repository is not safe to open, and no amount of review
 * catches an exfiltration hidden in a test fixture.
 *
 * GitHub already withholds secrets from a fork's `pull_request` run, so the real
 * risk is a workflow that quietly opts out of that protection. Two ways happen
 * in practice, and both are checked here:
 *
 *   1. A `pull_request` workflow that reads `secrets.*` at all. It works for a
 *      maintainer's branch and is empty for a fork, so it looks like a flaky
 *      test rather than a design mistake, and the usual fix is the next one.
 *
 *   2. `pull_request_target`, which runs with the base repository's secrets
 *      **and** the fork's code in scope. It exists for labelling bots. Using it
 *      to "fix" the first problem hands every secret to anyone who can open a
 *      pull request.
 *
 * Release and deployment workflows do use secrets. They are triggered by a push
 * to main or by a tag, which only a maintainer can cause, so they are allowed
 * here and are the reason this checks the trigger rather than the file.
 */
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const workflowsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'workflows')

/** Triggers that can be caused by someone who cannot merge. */
const UNTRUSTED_TRIGGERS = ['pull_request', 'issue_comment', 'workflow_dispatch']

/**
 * Read the `on:` block without a YAML parser.
 *
 * A dependency here would be a dependency in the job that proves the repository
 * has no dependencies it has to trust, which is a poor trade for parsing a list
 * of keys. Workflow triggers are top-level keys under `on:`, and that is all
 * this needs to see.
 */
function triggersOf(source) {
  const lines = source.split(/\r?\n/)
  const start = lines.findIndex((line) => /^on:/.test(line))
  if (start === -1) return []

  // `on: push` and `on: [push, pull_request]` are both legal.
  const inline = lines[start].slice(3).trim()
  if (inline && inline !== '|' && !inline.startsWith('#')) {
    return inline.replace(/[[\]]/g, '').split(',').map((trigger) => trigger.trim()).filter(Boolean)
  }

  const triggers = []
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break // back to a top-level key, so `on:` is over
    const match = /^ {2}([a-z_]+):/.exec(line)
    if (match) triggers.push(match[1])
  }
  return triggers
}

const problems = []

for (const name of (await readdir(workflowsDir)).filter((file) => /\.ya?ml$/.test(file))) {
  const source = await readFile(join(workflowsDir, name), 'utf8')
  const triggers = triggersOf(source)

  if (triggers.includes('pull_request_target')) {
    problems.push(
      `${name} uses pull_request_target, which runs with this repository's secrets while a fork's ` +
        `code is in scope. Use pull_request, and move anything needing a secret to a workflow a ` +
        `stranger cannot trigger.`,
    )
  }

  const untrusted = triggers.filter((trigger) => UNTRUSTED_TRIGGERS.includes(trigger))
  if (untrusted.length === 0) continue

  // Comments explaining the policy mention the word; only a real expansion counts.
  const uses = [...source.matchAll(/\$\{\{\s*secrets\.([A-Za-z0-9_]+)/g)].map((match) => match[1])
  if (uses.length > 0) {
    problems.push(
      `${name} runs on ${untrusted.join(', ')} and reads ${[...new Set(uses)].join(', ')}. ` +
        `A fork's run gets nothing for those, and the temptation to "fix" it with ` +
        `pull_request_target is how public repositories leak tokens.`,
    )
  }
}

if (problems.length > 0) {
  console.error('A pull request can reach a secret:\n')
  for (const problem of problems) console.error(`  - ${problem}\n`)
  process.exitCode = 1
} else {
  console.log('No workflow a stranger can trigger reads a secret, and none uses pull_request_target.')
}
