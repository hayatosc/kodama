/**
 * Checks the sidebar's order, its relative times, and its unread counter.
 *
 * @module
 */

import { describe, expect, test } from 'vite-plus/test'
import { formatRelativeTime, formatUnread, sortAgents, type SidebarAgent } from './sidebar.js'

const now = new Date(2026, 10, 25, 9, 30)
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString()

function agent(slug: string, extra: Partial<SidebarAgent>): SidebarAgent {
  return {
    agentId: slug,
    slug,
    kind: 'working',
    status: 'live',
    avatar: { color: 'violet', pose: 'idle' },
    latest: '',
    latestAt: ago(60),
    unread: 0,
    ...extra,
  }
}

describe('sortAgents', () => {
  test('puts pinned agents first, then running ones, then the most recent', () => {
    const sorted = sortAgents([
      agent('old', { latestAt: ago(600) }),
      agent('recent', { latestAt: ago(5) }),
      agent('running', { status: 'running', latestAt: ago(300) }),
      agent('pinned', { pinned: true, latestAt: ago(9000) }),
    ])
    expect(sorted.map((item) => item.slug)).toEqual(['pinned', 'running', 'recent', 'old'])
  })
})

describe('formatRelativeTime', () => {
  test('writes minutes, hours, yesterday, days, then the date', () => {
    expect(formatRelativeTime(ago(0), now)).toBe('今')
    expect(formatRelativeTime(ago(12), now)).toBe('12分')
    expect(formatRelativeTime(ago(185), now)).toBe('3時間')
    expect(formatRelativeTime(new Date(2026, 10, 24, 22, 0).toISOString(), now)).toBe('昨日')
    expect(formatRelativeTime(new Date(2026, 10, 22, 12, 0).toISOString(), now)).toBe('3日')
    expect(formatRelativeTime(new Date(2026, 9, 28, 12, 0).toISOString(), now)).toBe('10/28')
  })
})

describe('formatUnread', () => {
  test('caps the count at 99+', () => {
    expect(formatUnread(2)).toBe('2')
    expect(formatUnread(99)).toBe('99')
    expect(formatUnread(100)).toBe('99+')
  })
})
