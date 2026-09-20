import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Everything this process needs to know, read from the environment once.
 *
 * This is the one module allowed to name a host or a port. Every other file
 * takes what it needs as a parameter, which is what lets the product move from
 * one domain to another by changing a variable rather than by grepping, and what
 * lets a stranger run the whole thing on their laptop with nothing edited.
 */

const here = dirname(fileURLToPath(import.meta.url))

function text(name: string, fallback: string): string {
  const value = process.env[name]
  return value === undefined || value === '' ? fallback : value
}

function number(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) ? value : fallback
}

function list(name: string): string[] {
  return text(name, '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export interface Config {
  port: number
  host: string
  officeId: string
  logLevel: 'debug' | 'info' | 'warn' | 'error'

  /** The office: two files, and changing them changes the office. */
  templatePath: string
  configDir: string
  /** Re-read the template when it changes, which is what you want in development. */
  watchTemplate: boolean

  /**
   * How long somebody stays in their room after their last device drops.
   *
   * Thirty seconds is right for people. It is configurable because an
   * end-to-end test cannot wait that long to watch somebody disappear, and a
   * deployment on a flakier network may want longer.
   */
  graceMs: number

  /** Origins allowed to open a socket. Empty means same-origin only. */
  allowedOrigins: string[]

  /**
   * Public demo mode.
   *
   * Anyone with the link can walk in, so the ceiling and the limits exist to
   * stop the demo being used as free conferencing rather than to protect
   * anything private — there is nothing private in it.
   */
  demo: {
    enabled: boolean
    /** People in the office at once. Null means no ceiling. */
    maxPresent: number | null
  }
}

export function loadConfig(): Config {
  const configDir = resolve(text('CONFIG_DIR', resolve(here, '..', '..', 'config')))

  return {
    port: number('PORT', 4000),
    // 0.0.0.0 by default because the usual case is a container, where binding
    // to localhost means nothing outside can reach it.
    host: text('HOST', '0.0.0.0'),
    officeId: text('OFFICE_ID', 'office'),
    logLevel: text('LOG_LEVEL', 'info') as Config['logLevel'],

    templatePath: resolve(text('TEMPLATE_PATH', resolve(configDir, 'template.json'))),
    configDir,
    watchTemplate:
      text('WATCH_TEMPLATE', process.env.NODE_ENV === 'production' ? 'false' : 'true') === 'true',

    graceMs: number('PRESENCE_GRACE_MS', 30_000),
    allowedOrigins: list('ALLOWED_ORIGINS'),

    demo: {
      enabled: text('DEMO', 'false') === 'true',
      maxPresent: process.env.MAX_PRESENT ? number('MAX_PRESENT', 40) : null,
    },
  }
}

/**
 * What the client needs to know at boot, served as JSON.
 *
 * The app ships with no hostnames in it at all: it asks the server where things
 * are. That is what makes the same built bundle work on a laptop, on the demo
 * box and on somebody's own deployment.
 */
export function publicConfig(config: Config) {
  return {
    officeId: config.officeId,
    socketPath: '/socket',
    demo: config.demo.enabled,
  }
}
