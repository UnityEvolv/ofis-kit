/**
 * Which tab hosts the office.
 *
 * Every tab asks for the same Web Lock and waits. The one that holds it is the
 * host, and it holds it for as long as it is open; the browser releases it when
 * the tab closes or crashes, and hands it to the next tab in line, which starts
 * the office again. Nothing polls and nothing needs a heartbeat to notice: the
 * lock is released by the browser, not by a tab that might be too throttled or
 * too dead to say so.
 *
 * Without Web Locks (only very old browsers) the tab hosts an office of its own,
 * on a channel nobody else is on. Every tab is then alone, which is a smaller demo
 * but never a broken one: two tabs both thinking they were the host would be.
 */
export function hostWhenFree(name: string, host: () => void): { alone: boolean } {
  const locks = globalThis.navigator?.locks
  if (!locks) {
    host()
    return { alone: true }
  }

  void locks.request(name, () => {
    host()
    // Never settles: the lock is held until the tab goes away.
    return new Promise<never>(() => {})
  })
  return { alone: false }
}
