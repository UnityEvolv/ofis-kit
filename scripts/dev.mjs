/**
 * `npm run dev`: the office and the app, both watching.
 *
 * Three processes rather than one, because they are genuinely three things: the
 * packages compile, the server restarts when they do, and Vite serves the app
 * and proxies to the server. Written out here rather than pulled in as a task
 * runner, because a task runner would be a dependency whose only job is to
 * start three commands.
 */
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const children = []

function run(name, command, args, colour) {
  const child = spawn(command, args, { cwd: root, shell: process.platform === 'win32' })
  children.push(child)

  // Prefixed, because three interleaved logs with no labels is worse than one.
  const label = `\u001b[${colour}m${name.padEnd(8)}\u001b[0m`
  const forward = (stream, to) => {
    let partial = ''
    stream.on('data', (chunk) => {
      const lines = (partial + chunk.toString()).split('\n')
      partial = lines.pop() ?? ''
      for (const line of lines) to.write(`${label} ${line}\n`)
    })
  }
  forward(child.stdout, process.stdout)
  forward(child.stderr, process.stderr)

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      process.stderr.write(`${label} exited with ${code}\n`)
      stop(1)
    }
  })

  return child
}

function stop(code) {
  for (const child of children) child.kill()
  process.exit(code)
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0))

// The packages have to exist before the server can import them, so this one is
// awaited rather than started alongside the others.
process.stdout.write('Building packages…\n')
const build = spawn(npm, ['run', 'build:packages'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

build.on('exit', (code) => {
  if (code !== 0) process.exit(code ?? 1)

  // Recompiles the engine as it is edited, so a change in a package reaches the
  // running server without anybody restarting anything.
  run('packages', npm, ['run', 'watch:packages'], '36')
  run('server', npm, ['run', 'dev', '--workspace', 'ofiskit-server'], '35')
  run('app', npm, ['run', 'dev', '--workspace', 'ofiskit-app'], '32')

  process.stdout.write('\nThe app is on the address Vite prints below. The server is behind it.\n\n')
})
