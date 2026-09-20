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
