import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PHONE_QUERY, useOfficeView } from './useOfficeView.js'

/**
 * Which view the office opens on.
 *
 * The rule is a default, not a lock: a phone starts on the list because the map
 * at a phone's width is too small to use, and anybody who picks the map anyway is
 * remembered as having picked it.
 */

const original = globalThis.matchMedia

/** Pretend to be a screen of a given kind. Only the phone query answers true. */
function screenIs(kind: 'phone' | 'desktop') {
  globalThis.matchMedia = ((query: string) =>
    ({
      matches: kind === 'phone' && query === PHONE_QUERY,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList) as typeof globalThis.matchMedia
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  globalThis.matchMedia = original
})

describe('the view the office opens on', () => {
  it('is the list on a phone', () => {
    screenIs('phone')
    const { result } = renderHook(() => useOfficeView())

    expect(result.current.view).toBe('list')
    expect(result.current.narrow).toBe(true)
  })

  it('is the map on a wide screen', () => {
    screenIs('desktop')
    const { result } = renderHook(() => useOfficeView())

    expect(result.current.view).toBe('map')
    expect(result.current.narrow).toBe(false)
  })

  it('remembers somebody who chose the map on a phone', () => {
    // A choice, where the list was only the default.
    screenIs('phone')
    const first = renderHook(() => useOfficeView())
    act(() => first.result.current.setView('map'))
    first.unmount()

    const again = renderHook(() => useOfficeView())
    expect(again.result.current.view).toBe('map')
  })

  it('agrees with the stylesheet about what a phone is', () => {
    // Tailwind's sm starts at 640px, so a phone is anything narrower. Two different
    // numbers would leave one width where the page and the layout disagree.
    expect(PHONE_QUERY).toBe('(max-width: 639px)')
  })
})
