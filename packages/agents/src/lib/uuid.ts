/**
 * UUIDs: version 7 for new IDs, and the lowercase v4 or v7 form accepted as a public ID.
 *
 * @module
 */

/** A lowercase canonical UUID of version 4 or 7 with the RFC 9562 variant. */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/**
 * A new UUID v7: 48 bits of Unix milliseconds, then 74 random bits (RFC 9562).
 *
 * @param now - Unix epoch milliseconds; IDs made later sort after it.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let time = now
  for (let index = 5; index >= 0; index--) {
    bytes[index] = time % 256
    time = Math.floor(time / 256)
  }
  // getRandomValues fills all 16 bytes, so these reads are defined.
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f)
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f)
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Whether `value` is a lowercase canonical v4 or v7 UUID. */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}
