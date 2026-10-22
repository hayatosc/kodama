/**
 * Content hashes, as lowercase hex.
 *
 * @module
 */

/** SHA-256 of bytes, or of a string's UTF-8 encoding. */
export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
