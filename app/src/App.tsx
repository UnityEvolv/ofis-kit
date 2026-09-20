import { Spinner } from '@unityevolv/unitykit'
import { Suspense, lazy, useCallback, useEffect, useState } from 'react'

/**
 * The builder is loaded only when somebody opens it.
 *
 * It is a drawing tool with its own canvas logic and its own prompt document,
 * and nobody walking into the office needs any of it. The bundle budget checks
 * that the two stay apart, and fails if they ever merge.
 */
const BuilderPage = lazy(() =>
  import('./BuilderPage.js').then((module) => ({ default: module.BuilderPage })),
)

/**
 * The single-office app: an office, and a builder for drawing one.
 *
 * Routing is the path, read once. There is no router library because there are
 * two destinations, and a router would be the largest dependency in the bundle.
 *
 * The office itself is a placeholder until the stories that draw it land. The
 * builder is complete, and deliberately so: it is entirely client-side, so it
 * works with nothing running, which is how somebody produces the layout the
 * office then needs.
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

  if (route === 'builder') {
    return (
      <Suspense
        fallback={
          <main className="grid min-h-full place-items-center">
            <Spinner size="lg" />
          </main>
        }
      >
        <BuilderPage onBack={() => go('office')} />
      </Suspense>
    )
  }

  return (
    <main className="grid h-full place-items-center bg-base-100 p-6 text-base-content">
      <div className="max-w-md space-y-3 text-center">
        <p className="text-sm opacity-70">The office goes here.</p>
        <button type="button" className="text-sm text-primary underline" onClick={() => go('builder')}>
          Build a layout
        </button>
      </div>
    </main>
  )
}
