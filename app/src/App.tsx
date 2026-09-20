import { Alert, Spinner } from '@unityevolv/unitykit'
import { createOfisClient, type OfisClient } from '@unityevolv/ofiskit-realtime-client'
import { AnnouncerProvider } from '@unityevolv/ofiskit-ui-map'
import type { Template } from '@unityevolv/ofiskit-template'
import { Suspense, lazy, useCallback, useEffect, useState } from 'react'

import { EntryScreen } from './EntryScreen.js'
import { OfficePage } from './OfficePage.js'
import {
  deviceId,
  forgetEntry,
  loadConfig,
  recallEntry,
  rememberEntry,
  socketUrl,
  type Entry,
  type PublicConfig,
} from './config.js'

/**
 * The builder is loaded only when somebody opens it.
 *
 * It is a drawing tool with its own canvas logic and its own prompt document, and
 * nobody walking into the office needs any of it. The bundle budget checks that
 * the two stay apart, and fails if they ever merge.
 */
const BuilderPage = lazy(() =>
  import('./BuilderPage.js').then((module) => ({ default: module.BuilderPage })),
)

/**
 * The single-office app: an office, and a builder for drawing one.
 *
 * Routing is the path, read once. There is no router library because there are two
 * destinations, and a router would be the largest dependency in the bundle.
 */
type Route = 'office' | 'builder'

function routeFrom(pathname: string): Route {
  return pathname.endsWith('/builder') ? 'builder' : 'office'
}

export function App() {
  const [route, setRoute] = useState<Route>(() => routeFrom(globalThis.location.pathname))

  const go = useCallback((next: Route) => {
    setRoute(next)
    const path = next === 'builder' ? 'builder' : ''
    globalThis.history.pushState({}, '', `${import.meta.env.BASE_URL}${path}`)
  }, [])

  // The back button has to work. A single-page app that swallows it is a page
  // somebody cannot leave.
  useEffect(() => {
    const onPop = () => setRoute(routeFrom(globalThis.location.pathname))
    globalThis.addEventListener('popstate', onPop)
    return () => globalThis.removeEventListener('popstate', onPop)
  }, [])

  return (
    <AnnouncerProvider>
      {route === 'builder' ? (
        <Suspense
          fallback={
            <main className="grid min-h-full place-items-center">
              <Spinner size="lg" />
            </main>
          }
        >
          <BuilderPage onBack={() => go('office')} />
        </Suspense>
      ) : (
        <Office onBuilder={() => go('builder')} />
      )}
    </AnnouncerProvider>
  )
}

/**
 * The office half: find out what this deployment is, connect, then hand over.
 *
 * The client is made once and kept, because it owns the socket and a second one
 * would be a second person standing in the room.
 */
function Office({ onBuilder }: { onBuilder(): void }) {
  const [config, setConfig] = useState<PublicConfig | null>(null)
  const [template, setTemplate] = useState<Template | null>(null)
  const [client, setClient] = useState<OfisClient | null>(null)
  const [entered, setEntered] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  const [remembered] = useState(recallEntry)

  /**
   * Configuration, then the layout, then the socket, then walk back in.
   *
   * All of it in one place, in order, because each step needs the one before: the
   * socket path comes from the configuration, and walking back in needs the
   * socket. Somebody who has been here before does not type their name again on
   * every reload, and the server puts them back in the room they were in rather
   * than in reception.
   */
  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const loaded = await loadConfig()
        const response = await fetch('/v1/template')
        if (!response.ok) throw new Error('This office has no layout.')
        const layout = (await response.json()) as Template
        if (cancelled) return

        const connection = createOfisClient({
          url: socketUrl(),
          path: loaded.socketPath,
          deviceId: deviceId(),
          kind: 'web',
        })

        setConfig(loaded)
        setTemplate(layout)
        setClient(connection)

        if (remembered) {
          const result = await connection.enter(remembered)
          if (!cancelled && result.ok) setEntered(true)
        }
      } catch (cause) {
        if (!cancelled) setFailed(cause instanceof Error ? cause.message : 'Something went wrong.')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [remembered])

  // Close the socket on the way out, rather than leaving the server to work it
  // out from a heartbeat that stops arriving.
  useEffect(() => () => client?.close(), [client])

  const enter = useCallback(
    async (entry: Entry) => {
      if (!client) return 'Still connecting. Try again in a moment.'
      const result = await client.enter(entry)
      if (!result.ok) return result.message
      rememberEntry(entry)
      setEntered(true)
      return null
    },
    [client],
  )

  if (failed) {
    return (
      <main className="grid min-h-full place-items-center p-6">
        <div className="max-w-md space-y-3">
          <Alert variant="danger" title="The office is not answering">
            {failed}
          </Alert>
          <p className="text-sm text-base-content/70">
            If you are running this yourself, check that the server is up. You can still{' '}
            <button type="button" className="text-primary underline" onClick={onBuilder}>
              build a layout
            </button>
            , which needs nothing running.
          </p>
        </div>
      </main>
    )
  }

  if (!config || !template || !client) {
    return (
      <main className="grid min-h-full place-items-center">
        <Spinner size="lg" />
      </main>
    )
  }

  if (!entered) {
    return <EntryScreen onEnter={enter} demo={config.demo} initial={remembered} />
  }

  return (
    <OfficePage
      client={client}
      template={template}
      onLeave={() => {
        void client.leave()
        forgetEntry()
        setEntered(false)
      }}
    />
  )
}
