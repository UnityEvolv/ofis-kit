import { isAmbienceId, type AmbienceTrack } from '@unityevolv/ofiskit-template'

/**
 * Reading the ambience manifest, apart from fetching it, so it can be checked
 * against the real file without a browser or a server.
 */

interface ManifestEntry {
  id?: unknown
  label?: unknown
  file?: unknown
}

/** The tracks a manifest lists, keeping only the well-formed ones. */
export function readAmbienceManifest(
  manifest: unknown,
  url: (name: string) => string,
): AmbienceTrack[] {
  const tracks = (manifest as { tracks?: unknown } | null)?.tracks
  if (!Array.isArray(tracks)) return []
  return (tracks as ManifestEntry[]).flatMap((entry) =>
    isAmbienceId(entry.id) &&
    typeof entry.label === 'string' &&
    entry.label.length > 0 &&
    typeof entry.file === 'string' &&
    // A name beside the manifest, never a path out of the folder.
    /^[\w-][\w.-]*$/.test(entry.file)
      ? [{ id: entry.id, label: entry.label, src: url(`ambience/${entry.file}`) }]
      : [],
  )
}
