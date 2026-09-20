import type { ClientEvent, OfficeState, OfisClient } from '@unityevolv/ofiskit-realtime-client'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

/**
 * The React bindings.
 *
 * The client itself is framework-free so a React Native app can use it too.
 * These are the few hooks that turn it into something React can render, plus the
 * browser-only behaviour that cannot live in that package at all.
 */

/** The office, re-rendered when it changes. */
export function useOffice(client: OfisClient): OfficeState {
  return useSyncExternalStore(
    useCallback((notify) => client.subscribe(notify), [client]),
    useCallback(() => client.state(), [client]),
    useCallback(() => client.state(), [client]),
  )
}

/** Things that happen to you: a refusal to announce, a template that changed. */
export function useClientEvents(client: OfisClient, handler: (event: ClientEvent) => void): void {
  // Held in a ref so a caller can pass an inline function without
  // re-subscribing on every render — and written in an effect rather than during
  // render, because a render that is thrown away must not be able to change what
  // the live subscription will call.
  const latest = useRef(handler)

  useEffect(() => {
    latest.current = handler
  }, [handler])

  useEffect(() => client.on((event) => latest.current(event)), [client])
}

/**
 * Subscribe to a media query.
 *
 * `useSyncExternalStore` rather than an effect that calls setState: the browser
 * is the source of truth, React is reading from it, and this is the primitive for
 * exactly that. It also gets the first paint right, which an effect cannot.
 */
function useMatchMedia(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      const list = globalThis.matchMedia?.(query)
      if (!list) return () => {}
      list.addEventListener('change', notify)
      return () => list.removeEventListener('change', notify)
    },
    [query],
  )

  const read = useCallback(() => globalThis.matchMedia?.(query).matches ?? false, [query])

  // The server snapshot is false: there is no viewport to ask on a server, and
  // guessing would mean the first client render disagreed with the markup.
  return useSyncExternalStore(subscribe, read, () => false)
}

/**
 * Whether the person has asked for less motion.
 *
 * Honoured throughout: somebody moving room appears in the new room rather than
 * sliding to it. Motion is the part of this product most likely to make somebody
 * feel unwell, and a map where everything slides is the worst case of it.
 */
export function useReducedMotion(): boolean {
  return useMatchMedia('(prefers-reduced-motion: reduce)')
}

/** True while the viewport matches. Used to decide the narrow-screen layout. */
export function useMediaQuery(query: string): boolean {
  return useMatchMedia(query)
}

/**
 * A preference that survives a reload.
 *
 * Wrapped in try/catch because storage throws in private windows and with site
 * data blocked, and a remembered preference is never worth a blank page.
 */
export function usePersisted<T>(key: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored === null ? fallback : (JSON.parse(stored) as T)
    } catch {
      return fallback
    }
  })

  const store = useCallback(
    (next: T) => {
      setValue(next)
      try {
        localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // Not worth telling anybody about.
      }
    },
    [key],
  )

  return [value, store]
}

/**
 * The size of an element, measured rather than guessed.
 *
 * The map shares its space with the tile strip, which appears and disappears as
 * calls start and end, and a room bar decides how much of itself to show from how
 * wide its room actually is on screen. Neither can be worked out from a media
 * query.
 */
export function useMeasured<T extends HTMLElement>(): [
  React.RefObject<T | null>,
  { width: number; height: number },
] {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(([entry]) => {
      const rect = entry?.contentRect
      if (rect) setSize({ width: rect.width, height: rect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, size]
}

/**
 * How long without keyboard or pointer before this device counts as idle.
 *
 * Ten minutes, the same number the presence store resolves against. It is here as
 * well because the device is what notices, and the server is what decides — this
 * reports one device's signal and never a conclusion about the person.
 */
const IDLE_AFTER_MS = 10 * 60 * 1000

/**
 * Tell the office when this device goes quiet.
 *
 * Keyboard and pointer activity, plus the page being hidden, which is what a
 * screen locking or a tab going to the background looks like from here. The
 * server resolves across every device the person has open, so typing on a phone
 * keeps somebody available while their laptop sits idle.
 *
 * Suspended by the caller during a call, because somebody listening is not idle
 * even though they have not touched anything for twenty minutes.
 */
export function useIdleReporting(
  client: OfisClient,
  options: { enabled?: boolean; afterMs?: number } = {},
): void {
  const { enabled = true, afterMs = IDLE_AFTER_MS } = options
  const idle = useRef(false)

  useEffect(() => {
    if (!enabled) {
      // Leaving the feature has to leave the person active, or somebody who
      // joined a call while idle stays away for the length of it.
      if (idle.current) {
        idle.current = false
        client.setActivity({ idle: false, foreground: true })
      }
      return
    }

    let timer: ReturnType<typeof setTimeout> | null = null

    const report = (next: boolean) => {
      // Only on a change. These events arrive by the hundred and almost none of
      // them mean anything to anybody else.
      if (idle.current === next) return
      idle.current = next
      client.setActivity({ idle: next, foreground: !document.hidden })
    }

    const restart = () => {
      report(false)
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => report(true), afterMs)
    }

    const onVisibility = () => {
      // A hidden tab is not necessarily an idle person on a laptop, but it is the
      // only signal a browser gives for a locked screen.
      if (document.hidden) report(true)
      else restart()
    }

    // Passive: none of these ever calls preventDefault, and saying so keeps
    // scrolling smooth on a touch screen.
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const
    for (const event of events) globalThis.addEventListener(event, restart, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    restart()

    return () => {
      for (const event of events) globalThis.removeEventListener(event, restart)
      document.removeEventListener('visibilitychange', onVisibility)
      if (timer) clearTimeout(timer)
    }
  }, [client, enabled, afterMs])
}
