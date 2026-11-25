/**
 * Checks how the activity feed writes times.
 *
 * @module
 */

import { describe, expect, test } from 'vite-plus/test'
import { formatActivityTime } from './activity.js'

const now = new Date(2026, 10, 25, 9, 30)
const at = (...parts: [number, number, number, number, number]) => new Date(...parts).toISOString()

describe('formatActivityTime', () => {
  test('shows the time today, 昨日 yesterday, and the date before that', () => {
    expect(formatActivityTime(at(2026, 10, 25, 9, 0), now)).toBe('09:00')
    expect(formatActivityTime(at(2026, 10, 25, 0, 5), now)).toBe('00:05')
    expect(formatActivityTime(at(2026, 10, 24, 23, 59), now)).toBe('昨日')
    expect(formatActivityTime(at(2026, 10, 23, 12, 0), now)).toBe('11/23')
    expect(formatActivityTime(at(2025, 9, 28, 12, 0), now)).toBe('10/28')
  })
})
