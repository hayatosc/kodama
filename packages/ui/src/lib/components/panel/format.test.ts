/**
 * Tests for the side panels' times and agent order.
 *
 * @module
 */

import { describe, expect, test } from 'vite-plus/test'
import { activityTime, relativeTime, sortAgents } from './format.ts'

/** 2026-11-09 09:30 in local time, the "now" of these tests. */
const now = new Date(2026, 10, 9, 9, 30)

describe('relativeTime', () => {
  test('counts up from 今 through minutes, hours, and days', () => {
    expect(relativeTime(new Date(2026, 10, 9, 9, 29, 30), now)).toBe('今')
    expect(relativeTime(new Date(2026, 10, 9, 9, 28), now)).toBe('2分')
    expect(relativeTime(new Date(2026, 10, 9, 8, 0), now)).toBe('1時間')
    expect(relativeTime(new Date(2026, 10, 6, 9, 0), now)).toBe('3日')
  })
})

describe('activityTime', () => {
  test('shows the clock today, 昨日 yesterday, and the date before that', () => {
    expect(activityTime(new Date(2026, 10, 9, 3, 5), now)).toBe('03:05')
    expect(activityTime(new Date(2026, 10, 8, 23, 59), now)).toBe('昨日')
    expect(activityTime(new Date(2026, 9, 28, 12, 0), now)).toBe('10/28')
  })
})

describe('sortAgents', () => {
  test('puts running agents first, then the most recent', () => {
    const agents = [
      { slug: 'old', status: 'live', latestAt: '2026-11-01T00:00:00Z' },
      { slug: 'running', status: 'running', latestAt: '2026-10-01T00:00:00Z' },
      { slug: 'new', status: 'live', latestAt: '2026-11-08T00:00:00Z' },
    ]
    expect(sortAgents(agents).map((agent) => agent.slug)).toEqual(['running', 'new', 'old'])
    expect(agents.map((agent) => agent.slug)).toEqual(['old', 'running', 'new'])
  })
})
