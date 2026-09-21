/**
 * Choosing what to share, including where the browser cannot ask.
 *
 * On the web there is nothing to build: `getDisplayMedia` opens the browser's own
 * picker, which is the one people already know and the only one that can offer a
 * tab. On Electron that picker does not exist — the desktop capture API hands the
 * app a list of screens and windows and expects the app to draw it — so the host
 * supplies the list and the shared UI draws it the same way everywhere.
 *
 * Which is why this is an interface and not an implementation: ofiskit has no
 * desktop app, and nothing here imports Electron or knows it exists. A host that
 * has one passes a provider in; a browser passes nothing and gets the browser's
 * picker.
 */

/** What to share, and how. Everything is optional; nothing chooses for the person. */
export interface ShareOptions {
  /**
   * A source from a host-supplied picker.
   *
   * Absent means the browser asks, which is the web path and the better one where
   * it exists. Present means the person has already chosen from a list the host
   * provided, so nothing further should be asked.
   */
  sourceId?: string
}

/** One thing that can be shared, as a host's picker describes it. */
export interface ScreenSource {
  /** Opaque, and passed back as `ShareOptions.sourceId` untouched. */
  id: string
  /** A window title or a display name. Shown to the person, so it is theirs. */
  name: string
  kind: 'screen' | 'window'
  /**
   * A still of the source, as a data URL.
   *
   * A list of window titles is close to useless — half of them are the same word
   * repeated — and a thumbnail is how somebody recognises the thing they meant.
   * Optional because generating them costs the host something.
   */
  thumbnailUrl?: string
  /**
   * This is our own window.
   *
   * Sharing it produces an infinite mirror and is never what anybody meant, so it
   * is never offered. The host marks it because the host is the only thing that
   * knows its own window id; `usableSources` is what makes the marking count.
   */
  self?: boolean
}

/**
 * Where a list of shareable things comes from, on a platform that has to ask.
 *
 * One method, called when the picker opens rather than held: thumbnails go stale
 * the moment somebody moves a window, and a cached list offers a window that has
 * since been closed.
 */
export interface ScreenSourceProvider {
  list(): Promise<ScreenSource[]>
}

/**
 * The sources worth offering, in the order worth offering them.
 *
 * Our own window is dropped, whole screens come before windows, and everything
 * else keeps the host's order. Pure and separate from the picker that draws it,
 * because "never offer the app's own window" is a rule that has to be true rather
 * than drawn correctly — a mirror of the sharing app is the one screen share that
 * is guaranteed to be useless, and it looks exactly like a working one until
 * somebody scrolls.
 */
export function usableSources(sources: readonly ScreenSource[]): ScreenSource[] {
  return sources
    .filter((source) => source.self !== true)
    .map((source, index) => ({ source, index }))
    .sort((a, b) => {
      if (a.source.kind !== b.source.kind) return a.source.kind === 'screen' ? -1 : 1
      return a.index - b.index
    })
    .map((one) => one.source)
}

/**
 * The constraints that capture one host-chosen source.
 *
 * Chromium's desktop capture takes a source id through a non-standard `mandatory`
 * block rather than through `getDisplayMedia`, and this is the whole of the
 * platform-specific knowledge involved — kept pure so the shape can be tested
 * without a browser, and kept here rather than in the mesh so that the adapter has
 * nothing platform-specific in it.
 */
export function desktopConstraints(sourceId: string): MediaStreamConstraints {
  /*
   * Cast rather than declared, and through `unknown` rather than through `any`:
   * `mandatory` is not in the DOM's constraint types because it is not in the
   * standard — it is how Chromium, and therefore Electron, names a desktopCapturer
   * source. Widening the DOM types to admit it would let a typo through anywhere
   * constraints are built, so the cast stays in the one function that needs it.
   */
  const video = {
    mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId },
  } as unknown as MediaTrackConstraints

  return { audio: false, video }
}

/**
 * Whether a failed capture was somebody changing their mind.
 *
 * Closing the picker is the commonest outcome of pressing share and is not a
 * failure: nothing should be said about it, because the person knows exactly what
 * they just did. The browser reports it as a denied permission, which is also how
 * it reports an operating system that is blocking screen recording outright — and
 * that one must be said, because otherwise the button looks broken.
 *
 * The message is the only thing that tells the two apart, so it is what this reads.
 * Getting it wrong in the safe direction means one unnecessary sentence; getting it
 * wrong the other way means a person pressing a button that silently does nothing.
 */
export function shareCancelled(cause: unknown): boolean {
  if (!(cause instanceof Error) || cause.name !== 'NotAllowedError') return false
  return !/system/i.test(cause.message)
}

/**
 * Turn a failed screen capture into something worth reading.
 *
 * Same reasoning as the microphone's version: the fixes are completely different
 * and the browser's own messages explain none of them. Blocked at the operating
 * system level is the one people cannot solve by trying again, and it is invisible
 * from inside the browser — so it is named.
 */
export function describeShareError(cause: unknown): string {
  const name = cause instanceof Error ? cause.name : ''

  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Your computer is blocking screen recording. Allow it for this app in your system settings, then try again.'
    case 'NotFoundError':
      return 'There was nothing available to share.'
    case 'NotReadableError':
    case 'TrackStartError':
      return 'That screen could not be captured. Try sharing a window instead.'
    case 'AbortError':
      return 'The share stopped before it started. Try again.'
    case 'NotSupportedError':
      return 'This browser cannot share a screen. Try Chrome, Edge or Firefox on a computer.'
    default:
      return 'Your screen could not be shared.'
  }
}
