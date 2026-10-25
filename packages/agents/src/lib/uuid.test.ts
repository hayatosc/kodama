/**
 * The UUID library integration preserves canonical IDs, timestamps, and public-ID validation.
 *
 * @module
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isUuid, uuidv7 } from './uuid.ts'

afterEach(() => vi.restoreAllMocks())

describe('uuidv7', () => {
  it('is a lowercase canonical UUID with version 7 and the RFC 9562 variant', () => {
    const id = uuidv7()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(isUuid(id)).toBe(true)
  })

  it('defaults to the current time in milliseconds', () => {
    const now = Date.UTC(2026, 9, 24, 12, 0, 0, 123)
    vi.spyOn(Date, 'now').mockReturnValue(now)
    expect(Number.parseInt(uuidv7().replaceAll('-', '').slice(0, 12), 16)).toBe(now)
  })

  it('preserves the explicitly supplied creation time in milliseconds', () => {
    const now = Date.UTC(2026, 9, 24, 12, 0, 0, 123)
    const id = uuidv7(now)
    expect(Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16)).toBe(now)
  })

  it('sorts by creation time and does not repeat within one millisecond', () => {
    const ids = Array.from({ length: 1_000 }, () => uuidv7(1_000))
    expect(new Set(ids).size).toBe(ids.length)
    // Generation order must not override the caller's supplied timestamp.
    const later = uuidv7(65_536)
    const earlier = uuidv7(65_535)
    const first = uuidv7(1_000)
    expect([later, first, earlier].sort()).toEqual([first, earlier, later])
  })
})

describe('isUuid', () => {
  it('accepts lowercase v7 UUIDs only', () => {
    expect(isUuid(uuidv7())).toBe(true)
    expect(isUuid('00000000-0000-7000-8000-00000000000a')).toBe(true)
    for (const value of [
      '550e8400-e29b-41d4-a716-446655440000',
      uuidv7().toUpperCase(),
      '00000000-0000-1000-8000-000000000000',
      '00000000-0000-7000-c000-000000000000',
      'kodama:memory',
      'assistant',
      '',
    ]) {
      expect(isUuid(value)).toBe(false)
    }
  })
})
