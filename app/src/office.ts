import { createOfisClient, type OfisClient } from '@unityevolv/ofiskit-realtime-client'
import type { Template } from '@unityevolv/ofiskit-template'

import { deviceId, isPagesBuild, loadConfig, socketUrl, type PublicConfig } from './config.js'

/**
 * Where the office comes from: a server, or this browser.
 *
 * Everything else in the app is the same either way. A normal build asks its own
 * origin for the configuration and the layout and opens a socket to it. The Pages
 * build has no server to ask, so it runs the office in the browser and hands the
 * client a socket to that instead — through the client's own `connect` option,
 * which exists for exactly this.
 *
 * The demo is imported only when it is needed. In a normal build `isPagesBuild`
 * is the constant `false`, so the bundler drops the branch and none of the
 * in-browser office ships to anybody running a server.
 */
export interface Office {
  config: PublicConfig
  template: Template
  client: OfisClient
}

export async function openOffice(): Promise<Office> {
  if (isPagesBuild) {
    const { DEMO_OFFICE_ID, startDemo } = await import('./demo/index.js')
    const demo = startDemo()
    const device = deviceId()
    return {
      config: {
        officeId: DEMO_OFFICE_ID,
        socketPath: '',
        demo: true,
        hasTurn: false,
        inBrowser: { shared: demo.shared },
      },
      template: demo.template,
      client: createOfisClient({
        url: 'demo',
        deviceId: device,
        kind: 'web',
        connect: () => demo.connect(device),
      }),
    }
  }

  const config = await loadConfig()
  const response = await fetch('/v1/template')
  if (!response.ok) throw new Error('This office has no layout.')
  const template = (await response.json()) as Template

  return {
    config,
    template,
    client: createOfisClient({
      url: socketUrl(),
      path: config.socketPath,
      deviceId: deviceId(),
      kind: 'web',
    }),
  }
}
