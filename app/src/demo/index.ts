import type { SocketLike } from '@unityevolv/ofiskit-realtime-client'
import { parseTemplate, type Template } from '@unityevolv/ofiskit-template'

import shipped from '../../../config/template.json'
import { channelName } from './channel.js'
import { startColleagues } from './colleagues.js'
import { startDemoHost } from './host.js'
import { hostWhenFree } from './leader.js'
import { channelSocket } from './socket.js'

/**
 * The whole office in the browser: the Pages build's stand-in for the server.
 *
 * Loaded only by that build. It gives the app the three things it would
 * otherwise ask a server for — the layout, a socket, and an office behind the
 * socket — and makes sure exactly one tab on this device is running the office.
 *
 * The layout is the one that ships in `config/`, bundled at build time, so the
 * demo is the same office a fresh clone opens.
 */

export const DEMO_OFFICE_ID = 'demo'

export interface Demo {
  template: Template
  /** A socket to the office, for this tab's client. */
  connect(deviceId: string): SocketLike
  /** False when the browser has no Web Locks, and every tab is an office alone. */
  shared: boolean
}

export function startDemo(): Demo {
  const parsed = parseTemplate(JSON.stringify(shipped))
  // A broken shipped template is a broken build, and this says which way.
  if (!parsed.ok) throw new Error(`The shipped template is invalid: ${parsed.issues[0]?.message}`)
  const template = parsed.value

  // Without Web Locks every tab is alone, so each gets a channel of its own.
  const locks = Boolean(globalThis.navigator?.locks)
  const channel = locks
    ? channelName(DEMO_OFFICE_ID)
    : channelName(`${DEMO_OFFICE_ID}:${globalThis.crypto.randomUUID()}`)

  hostWhenFree(`${channel}:host`, () => {
    startDemoHost({ channel, officeId: DEMO_OFFICE_ID, template })
    startColleagues({ channel, template })
  })

  return {
    template,
    connect: (deviceId) => channelSocket({ channel, deviceId }),
    shared: locks,
  }
}
