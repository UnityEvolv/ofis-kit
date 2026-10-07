import type { AmbienceTrack } from '@unityevolv/ofiskit-template'
import { useEffect, useState } from 'react'

import { readAmbienceManifest } from './ambienceManifest.js'
import { officeImageUrl } from './config.js'

/**
 * This app's ambience library: `config/ambience/manifest.json` and the loops
 * beside it, served under `office/` like the background images.
 *
 * The manifest is the catalogue. A template stores only an id, so a host swaps
 * a loop by replacing its file and its entry, and adds one by adding both;
 * nothing here changes. Each entry also records where the file came from and
 * under what licence, which is the manifest's other job.
 *
 * A missing or unreadable manifest is an empty library, not an error: the
 * office works exactly as before, in silence, and the builder offers no loops.
 */

export const AMBIENCE_MANIFEST = 'ambience/manifest.json'

/** Fetch the library. Empty, never thrown, when there is none. */
export async function loadAmbienceLibrary(signal?: AbortSignal): Promise<AmbienceTrack[]> {
  try {
    const response = await fetch(officeImageUrl(AMBIENCE_MANIFEST), signal ? { signal } : {})
    if (!response.ok) return []
    return readAmbienceManifest(await response.json(), officeImageUrl)
  } catch {
    return []
  }
}

/**
 * The library, once per page. Empty until it arrives, and empty for good when
 * there is none, which is an office with no ambience rather than a broken one.
 */
export function useAmbienceLibrary(): AmbienceTrack[] {
  const [library, setLibrary] = useState<AmbienceTrack[]>([])
  useEffect(() => {
    const controller = new AbortController()
    void loadAmbienceLibrary(controller.signal).then((tracks) => {
      if (!controller.signal.aborted) setLibrary(tracks)
    })
    return () => controller.abort()
  }, [])
  return library
}
