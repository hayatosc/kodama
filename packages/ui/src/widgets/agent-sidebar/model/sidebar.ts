/**
 * The agents the sidebar lists, the order it lists them in, and how a row writes its time and
 * unread count.
 *
 * @module
 */

import type { AgentColor, AgentPose, RunState } from '#entities/agent/index.js'
import { calendarDaysBetween } from '#shared/lib/dates.js'

/** One agent in the sidebar (design/components/Sidebar). */
export type SidebarAgent = {
  agentId: string
  slug: string
  kind: 'working' | 'dedicated'
  status: RunState
  avatar: { color: AgentColor; pose: AgentPose }
  /** One line about the latest event, or what the agent is doing now. */
  latest: string
  /** When the latest event happened, as an ISO-8601 time. */
  latestAt: string
  unread: number
  /** Pinned by hand: listed before every other agent. */
  pinned?: boolean
}

/**
 * The sidebar's order: pinned agents, then running ones, then the most recent activity first.
 * Sorts a copy.
 */
export function sortAgents(agents: readonly SidebarAgent[]): SidebarAgent[] {
  return agents.toSorted(
    (a, b) =>
      Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
      Number(b.status === 'running') - Number(a.status === 'running') ||
      Date.parse(b.latestAt) - Date.parse(a.latestAt),
  )
}

/**
 * How long ago, as a row writes it: 「今」 under a minute, then 「12分」, 「3時間」, 「昨日」,
 * 「3日」 within a week, and the date (`10/28`) after that.
 */
export function formatRelativeTime(at: string, now: Date): string {
  const time = new Date(at)
  const minutes = Math.floor((now.getTime() - time.getTime()) / 60_000)
  if (minutes < 1) return '今'
  if (minutes < 60) return `${minutes}分`
  const days = calendarDaysBetween(time, now)
  if (days === 0) return `${Math.floor(minutes / 60)}時間`
  if (days === 1) return '昨日'
  if (days < 7) return `${days}日`
  return `${time.getMonth() + 1}/${time.getDate()}`
}

/** An unread count as the counter shows it: up to 99, then 「99+」. */
export function formatUnread(count: number): string {
  return count > 99 ? '99+' : String(count)
}
