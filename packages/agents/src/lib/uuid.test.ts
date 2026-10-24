import { describe, expect, it } from 'vitest'
import { isUuid, uuidv7 } from './uuid.ts'

describe('uuidv7', () => {
  it('is a lowercase canonical UUID with version 7 and the RFC 9562 variant', () => {
    const id = uuidv7()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(isUuid(id)).toBe(true)
  })

  it('starts with the creation time in milliseconds', () => {
    const now = Date.UTC(2026, 9, 24, 12, 0, 0, 123)
    const id = uuidv7(now)
    expect(Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16)).toBe(now)
  })

  it('sorts by creation time and does not repeat within one millisecond', () => {
    const ids = Array.from({ length: 1_000 }, () => uuidv7(1_000))
    expect(new Set(ids).size).toBe(ids.length)
    expect(uuidv7(1_000) < uuidv7(1_001)).toBe(true)
  })
})

describe('isUuid', () => {
  it('accepts lowercase v4 and v7 UUIDs only', () => {
    expect(isUuid(crypto.randomUUID())).toBe(true)
    expect(isUuid('00000000-0000-7000-8000-00000000000a')).toBe(true)
    for (const value of [
      crypto.randomUUID().toUpperCase(),
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
