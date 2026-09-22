/**
 * What the app is told at boot.
 *
 * The bundle contains no hostname at all: it asks its own origin where things
 * are. That is what lets the same built files run on a laptop, on the public demo
 * and on somebody's private deployment with nothing rebuilt, and it is why a
 * hostname literal fails lint everywhere except in a config module.
 */

declare const __PAGES__: boolean

export interface PublicConfig {
  officeId: string
  socketPath: string
  /** True on the public demo, which says so on screen. */
  demo: boolean
  /**
   * False when no relay is configured.
   *
   * Worth knowing before a call rather than during one: without a relay, calls
   * work between people on the same network and may not connect across a
   * corporate firewall.
   */
  hasTurn: boolean
  /**
   * Present when the office runs in this browser rather than on a server: the
   * Pages demo. Everyone in it is a tab on this device. `shared` is false in a
   * browser without Web Locks, where each tab has an office to itself.
   */
  inBrowser?: { shared: boolean }
}

/**
 * True in the Pages build: the demo, where the whole office runs in the browser
 * because there is no server to run it on.
 */
export const isPagesBuild = __PAGES__

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
    const existing = identityStorage().getItem(KEY)
    if (existing) return existing
    const fresh = globalThis.crypto.randomUUID()
    identityStorage().setItem(KEY, fresh)
    return fresh
  } catch {
    // Private windows and blocked storage: a per-session id still works, it just
    // makes a reload look like a new device.
    return globalThis.crypto.randomUUID()
  }
}

/**
 * Where who-you-are is kept: this browser, or in the demo this tab.
 *
 * On a server every tab of one browser is one device, and one person. In the demo
 * every tab is a colleague — that is how one laptop fills an office — so the
 * device and the person are kept per tab, and survive a reload of it.
 */
function identityStorage(): Storage {
  return isPagesBuild ? sessionStorage : localStorage
}

/** What was typed on the way in, so a refresh does not ask again. */
export interface Entry {
  email: string
  name: string
}

const ENTRY_KEY = 'ofiskit:entry'

export function rememberEntry(entry: Entry): void {
  try {
    identityStorage().setItem(ENTRY_KEY, JSON.stringify(entry))
  } catch {
    // Not worth mentioning; they will type it again.
  }
}

export function recallEntry(): Entry | null {
  try {
    const stored = identityStorage().getItem(ENTRY_KEY)
    return stored ? (JSON.parse(stored) as Entry) : null
  } catch {
    return null
  }
}

export function forgetEntry(): void {
  try {
    identityStorage().removeItem(ENTRY_KEY)
  } catch {
    // Nothing to do.
  }
}
