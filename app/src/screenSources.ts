import type { ScreenSourceProvider } from '@unityevolv/ofiskit-realtime-client'

/**
 * Where a list of screens and windows comes from, when the browser cannot ask.
 *
 * On the web there is nothing to do: `getDisplayMedia` opens the browser's own
 * picker, which is the one people know and the only one that can offer a single
 * tab. Inside a desktop shell there is no such dialog, so the shell exposes its own
 * list on this one object and the shared picker draws it.
 *
 * This is the whole of the contract, and it is deliberately tiny: the desktop app
 * enumerates sources with the platform's capture API, **leaves its own window out**
 * — sharing the window that is doing the sharing is an infinite mirror — and passes
 * them through. Nothing in the packages knows any of that; they take a provider or
 * they take none.
 */
interface DesktopShell {
  screenSources?: ScreenSourceProvider
}

export function hostScreenSources(): ScreenSourceProvider | null {
  const shell = (globalThis as typeof globalThis & { ofis?: DesktopShell }).ofis
  // Checked by shape rather than trusted, because this comes from outside the app:
  // a shell that exposes half of the contract should fall back to the browser's
  // picker rather than fail when somebody presses share.
  return typeof shell?.screenSources?.list === 'function' ? shell.screenSources : null
}
