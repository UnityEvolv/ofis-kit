import { describe, expect, it } from 'vitest'

import {
  describeShareError,
  desktopConstraints,
  shareCancelled,
  usableSources,
  type ScreenSource,
} from './screen.js'

/**
 * Choosing what to share, tested without a screen.
 *
 * All four of these are pure, which is the reason they exist as functions at all:
 * "never offer the app's own window" and "a closed picker is not a failure" are
 * rules, and a rule that can only be checked by opening a real picker on a real
 * desktop is a rule nothing checks.
 */

const source = (overrides: Partial<ScreenSource> = {}): ScreenSource => ({
  id: 'window:1',
  name: 'Spreadsheet',
  kind: 'window',
  ...overrides,
})

describe('the sources worth offering', () => {
  it('never offers the app’s own window', () => {
    // Sharing the window that is doing the sharing is an infinite mirror, and it
    // looks exactly like a working share until somebody scrolls.
    const offered = usableSources([
      source({ id: 'window:self', name: 'Office', self: true }),
      source({ id: 'window:2', name: 'Spreadsheet' }),
    ])

    expect(offered.map((one) => one.id)).toEqual(['window:2'])
  })

  it('puts whole screens first', () => {
    // What most people mean by "share my screen", and what somebody demonstrating
    // something almost always wants.
    const offered = usableSources([
      source({ id: 'window:1', kind: 'window', name: 'Notes' }),
      source({ id: 'screen:1', kind: 'screen', name: 'Screen 1' }),
    ])

    expect(offered.map((one) => one.id)).toEqual(['screen:1', 'window:1'])
  })

  it('keeps the host’s own order within each kind', () => {
    // The platform lists windows in a useful order — most recently used first —
    // and sorting them by name would throw that away.
    const offered = usableSources([
      source({ id: 'window:b', name: 'Zebra' }),
      source({ id: 'window:a', name: 'Apple' }),
    ])

    expect(offered.map((one) => one.id)).toEqual(['window:b', 'window:a'])
  })

  it('has nothing to offer for a list with only our own window in it', () => {
    expect(usableSources([source({ self: true })])).toEqual([])
  })
})

describe('capturing one chosen source', () => {
  it('asks for that source and for no audio', () => {
    const constraints = desktopConstraints('screen:7')

    // Loopback audio from a desktop capture is platform-specific and silently
    // different on each one, so the desktop path does not ask for it.
    expect(constraints.audio).toBe(false)
    expect(constraints.video).toMatchObject({
      mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: 'screen:7' },
    })
  })
})

describe('a share that did not start', () => {
  const error = (name: string, message = '') => Object.assign(new Error(message), { name })

  it('treats a closed picker as somebody changing their mind', () => {
    // The commonest outcome of pressing share, and nothing should be said about it:
    // the person knows exactly what they just did.
    expect(shareCancelled(error('NotAllowedError'))).toBe(true)
  })

  it('does not treat a blocked operating system as a change of mind', () => {
    // Reported identically by the browser, and the one case that has to be said
    // out loud: otherwise the button appears to do nothing at all.
    expect(shareCancelled(error('NotAllowedError', 'Permission denied by system'))).toBe(false)
  })

  it('treats anything else as a failure worth reporting', () => {
    expect(shareCancelled(error('NotReadableError'))).toBe(false)
    expect(shareCancelled('not an error at all')).toBe(false)
  })

  it('says what to do about a blocked screen recording', () => {
    expect(describeShareError(error('NotAllowedError'))).toMatch(/system settings/i)
  })

  it('gives a different sentence for each different fix', () => {
    const messages = [
      'NotAllowedError',
      'NotFoundError',
      'NotReadableError',
      'AbortError',
      'NotSupportedError',
      'SomethingNew',
    ].map((name) => describeShareError(error(name)))

    // A message that does not distinguish one problem from another is a message
    // that sends somebody to support.
    expect(new Set(messages).size).toBe(messages.length)
  })

  it('still says something useful for a failure it has never seen', () => {
    expect(describeShareError({ weird: true })).toBe('Your screen could not be shared.')
  })
})
