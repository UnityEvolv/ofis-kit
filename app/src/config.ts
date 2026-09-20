/**
 * What the app is told at boot.
 *
 * The bundle contains no hostname at all: it asks its own origin where things
 * are. That is what lets the same built files run on a laptop, on the public demo
 * and on somebody's private deployment with nothing rebuilt, and it is why a
 * hostname literal fails lint everywhere except in a config module.
 */

declare const __PAGES__: boolean
declare const __DEMO_URL__: string

export interface PublicConfig {
  officeId: string
  socketPath: string
  /** True on the public demo, which says so on screen. */
  demo: boolean
}

/** True in the Pages build, which has the builder but no office. */
export const isPagesBuild = __PAGES__

/** Where the live office is, for the Pages build to link to. Empty if unset. */
export const demoUrl = __DEMO_URL__

export async function loadConfig(): Promise<PublicConfig> {
  const response = await fetch('/config')
  if (!response.ok) throw new Error('The office did not answer. Is the server running?')
  return (await response.json()) as PublicConfig
}

/**
 * The socket's address: this origin.
 *
 * Built from `location` rather than from a constant, so it follows whatever host
 * the app was served from.
 */
export function socketUrl(): string {
  return globalThis.location.origin
}

/**
 * Where the office's images are served from.
 *
 * The template names files; the host decides where those files live. Here they
 * sit in the config folder beside `template.json` and the server serves them
 * under `/office/`.
 */
export function officeImageUrl(name: string): string {
  return `/office/${name}`
}

/**
 * A stable id for this browser.
 *
 * Presence is per user and a person may have several devices, so each one has to
 * be recognisable across reconnects — otherwise a refresh looks like a new device
 * arriving while the old one lingers through the grace period, and the person
 * appears twice in their own room.
 */
export function deviceId(): string {
  const KEY = 'ofiskit:device'
  try {
    const existing = localStorage.getItem(KEY)
    if (existing) return existing
    const fresh = globalThis.crypto.randomUUID()
    localStorage.setItem(KEY, fresh)
    return fresh
  } catch {
    // Private windows and blocked storage: a per-session id still works, it just
    // makes a reload look like a new device.
    return globalThis.crypto.randomUUID()
  }
}

/** What was typed on the way in, so a refresh does not ask again. */
export interface Entry {
  email: string
  name: string
}

const ENTRY_KEY = 'ofiskit:entry'

export function rememberEntry(entry: Entry): void {
  try {
    localStorage.setItem(ENTRY_KEY, JSON.stringify(entry))
  } catch {
    // Not worth mentioning; they will type it again.
  }
}

export function recallEntry(): Entry | null {
  try {
    const stored = localStorage.getItem(ENTRY_KEY)
    return stored ? (JSON.parse(stored) as Entry) : null
  } catch {
    return null
  }
}

export function forgetEntry(): void {
  try {
    localStorage.removeItem(ENTRY_KEY)
  } catch {
    // Nothing to do.
  }
}
