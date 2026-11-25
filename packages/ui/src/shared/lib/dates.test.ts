/**
 * Checks the calendar-day count the time labels rely on.
 *
 * @module
 */

import { expect, test } from 'vite-plus/test'
import { calendarDaysBetween } from './dates.js'

test('counts calendar days, not 24-hour spans', () => {
  expect(calendarDaysBetween(new Date(2026, 10, 24, 23, 59), new Date(2026, 10, 25, 0, 1))).toBe(1)
  expect(calendarDaysBetween(new Date(2026, 10, 25, 0, 1), new Date(2026, 10, 25, 23, 59))).toBe(0)
  expect(calendarDaysBetween(new Date(2026, 2, 1), new Date(2026, 2, 31))).toBe(30)
})
