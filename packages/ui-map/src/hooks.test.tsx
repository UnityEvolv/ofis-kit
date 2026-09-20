import type { OfisClient } from '@unityevolv/ofiskit-realtime-client'
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useIdleReporting } from './hooks.js'

/**
 * Idle detection, which is this device reporting a signal and never a conclusion.
 *
 * The distinction is the whole point: the server resolves across every device
 * somebody has open, so typing on a phone keeps them available while their laptop
 * sits idle. A hook that decided "this person is away" would make that impossible.
 */

function fakeClient() {
  const reported: Array<{ idle: boolean; foreground: boolean }> = []
  const client = {
    setActivity(activity: { idle: boolean; foreground: boolean }) {
      reported.push(activity)
    },
  } as unknown as OfisClient

  return { client, reported }
}

function Watching({ client, enabled = true }: { client: OfisClient; enabled?: boolean }) {
  useIdleReporting(client, { enabled, afterMs: 10 * 60 * 1000 })
  return null
}

afterEach(() => {
  vi.useRealTimers()
})

describe('telling the office this device went quiet', () => {
  it('reports active straight away, so nobody starts out idle', () => {
    const { client, reported } = fakeClient()
    render(<Watching client={client} />)

    // Nothing is reported, because the device has not changed state: it opened
    // active and it is active. The first report is the first change.
    expect(reported).toEqual([])
  })

  it('reports idle after ten minutes of nothing', () => {
    vi.useFakeTimers()
    const { client, reported } = fakeClient()
    render(<Watching client={client} />)

    vi.advanceTimersByTime(10 * 60 * 1000)

    expect(reported).toEqual([{ idle: true, foreground: true }])
  })

  it('reports active again on the first keypress, and only once', () => {
    vi.useFakeTimers()
    const { client, reported } = fakeClient()
    render(<Watching client={client} />)
    vi.advanceTimersByTime(10 * 60 * 1000)

    globalThis.dispatchEvent(new Event('keydown'))
    globalThis.dispatchEvent(new Event('keydown'))
    globalThis.dispatchEvent(new Event('pointermove'))

    // Three events, one report. These arrive by the hundred and almost none of
    // them mean anything to anybody else.
    expect(reported).toEqual([
      { idle: true, foreground: true },
      { idle: false, foreground: true },
    ])
  })

  it('starts the ten minutes again after activity', () => {
    vi.useFakeTimers()
    const { client, reported } = fakeClient()
    render(<Watching client={client} />)

    vi.advanceTimersByTime(9 * 60 * 1000)
    globalThis.dispatchEvent(new Event('keydown'))
    vi.advanceTimersByTime(9 * 60 * 1000)

    // Eighteen minutes have passed and neither stretch reached ten.
    expect(reported).toEqual([])
  })

  it('treats a hidden tab as idle, because that is all a browser will say', () => {
    vi.useFakeTimers()
    const { client, reported } = fakeClient()
    render(<Watching client={client} />)

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))

    // Not necessarily an idle person on a laptop, but it is the only signal there
    // is for a screen locking.
    expect(reported).toEqual([{ idle: true, foreground: false }])
    hidden.mockRestore()
  })

  it('reports active again when the tab comes back', () => {
    vi.useFakeTimers()
    const { client, reported } = fakeClient()
    render(<Watching client={client} />)

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    hidden.mockReturnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))

    expect(reported.at(-1)).toEqual({ idle: false, foreground: true })
  })

  it('puts somebody back to active when reporting is switched off', () => {
    // Which is what a call does: somebody listening is not idle even though they
    // have not touched anything for twenty minutes. Leaving them idle for the
    // length of a call is the bug this prevents.
    vi.useFakeTimers()
    const { client, reported } = fakeClient()
    const view = render(<Watching client={client} />)

    vi.advanceTimersByTime(10 * 60 * 1000)
    expect(reported).toEqual([{ idle: true, foreground: true }])

    view.rerender(<Watching client={client} enabled={false} />)
    expect(reported.at(-1)).toEqual({ idle: false, foreground: true })
  })

  it('stops watching when it goes away', () => {
    vi.useFakeTimers()
    const { client, reported } = fakeClient()
    const view = render(<Watching client={client} />)

    view.unmount()
    vi.advanceTimersByTime(30 * 60 * 1000)
    globalThis.dispatchEvent(new Event('keydown'))

    expect(reported).toEqual([])
  })
})
