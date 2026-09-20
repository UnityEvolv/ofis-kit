/**
 * UUIDv7, the only kind of id anything here makes.
 *
 * Time-ordered, so ids sort by when they were made and index without
 * fragmenting; opaque, so nothing about them is guessable or countable. Both
 * matter: the first is why a database likes them, the second is why a room id in
 * a URL tells a stranger nothing.
 *
 * It lives in this package because this is the lowest one, so every layer can
 * make an id without a dependency cycle. `realtime-core` re-exports it, which is
 * where most callers will find it.
 *
 * The layout, from RFC 9562:
 *
 *   48 bits  milliseconds since the Unix epoch
 *    4 bits  version, always 7
 *   12 bits  a counter, so ids made in the same millisecond still sort
 *    2 bits  variant, always 0b10
 *   62 bits  random
 */

/** The millisecond the last id was minted in, and how many we minted in it. */
let lastMillis = -1
let counter = 0

const HEX: string[] = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, '0'))

/**
 * Random bytes from the platform.
 *
 * `globalThis.crypto` is present in Node 19 and later, in every browser, and in
 * React Native with a polyfill. It is deliberately not the DOM: this package has
 * to run on a phone.
 */
function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

/**
 * A new UUIDv7.
 *
 * `at` exists for tests, which need to know what time it is. Nothing in
 * production passes it.
 */
export function newId(at: number = Date.now()): string {
  const millis = Math.max(at, 0)

  // Two ids in the same millisecond would otherwise sort arbitrarily against
  // each other, which defeats the point of a time-ordered id. The counter
  // orders them; if it ever filled within one millisecond we would be minting
  // 4096 ids in that millisecond, so it rolls rather than blocking.
  if (millis === lastMillis) {
    counter = (counter + 1) & 0xfff
  } else {
    lastMillis = millis
    counter = 0
  }

  const bytes = randomBytes(16)

  // 48 bits of timestamp, big-endian.
  bytes[0] = (millis / 2 ** 40) & 0xff
  bytes[1] = (millis / 2 ** 32) & 0xff
  bytes[2] = (millis / 2 ** 24) & 0xff
  bytes[3] = (millis / 2 ** 16) & 0xff
  bytes[4] = (millis / 2 ** 8) & 0xff
  bytes[5] = millis & 0xff

  // Version 7 in the top nibble, then the counter across the remaining 12 bits.
  bytes[6] = 0x70 | ((counter >> 8) & 0x0f)
  bytes[7] = counter & 0xff

  // Variant 0b10 in the top two bits; the rest of the byte stays random.
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f)

  const hex = (index: number) => HEX[bytes[index] ?? 0] ?? '00'
  const slice = (from: number, to: number) => {
    let out = ''
    for (let index = from; index < to; index += 1) out += hex(index)
    return out
  }

  return `${slice(0, 4)}-${slice(4, 6)}-${slice(6, 8)}-${slice(8, 10)}-${slice(10, 16)}`
}

/** True when this looks like a UUIDv7 we made. Used at trust boundaries. */
export function isId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  )
}

/** When an id was minted, as an instant. Useful in logs, which carry ids only. */
export function idMintedAt(id: string): Date | null {
  if (!isId(id)) return null
  return new Date(Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16))
}
