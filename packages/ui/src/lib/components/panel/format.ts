/**
 * Times and ordering for the side panels: relative times in lists, clock times in activity, and
 * the order of the agent list.
 *
 * @module
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Midnight at the start of a date, in local time. */
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/**
 * A list row's time: 今 (now) under a minute, then minutes, hours, and days, short enough for
 * the right edge of a sidebar row (design/README.md — Wording).
 */
export function relativeTime(at: Date, now: Date): string {
  const elapsed = now.getTime() - at.getTime()
  if (elapsed < MINUTE) return '今'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}分`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}時間`
  return `${Math.floor(elapsed / DAY)}日`
}

/** An activity time: 09:00 today, 昨日 (yesterday), then the month and day, as 10/28. */
export function activityTime(at: Date, now: Date): string {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY)
  if (days <= 0) {
    return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  }
  if (days === 1) return '昨日'
  return `${at.getMonth() + 1}/${at.getDate()}`
}

/** What sorting the agent list needs from an agent. */
export type Sortable = { status: string; latestAt: string }

/** The agent list's order: running agents first, then the most recent activity. */
export function sortAgents<T extends Sortable>(agents: readonly T[]): T[] {
  return agents.toSorted((a, b) => {
    const running = Number(b.status === 'running') - Number(a.status === 'running')
    return running !== 0 ? running : Date.parse(b.latestAt) - Date.parse(a.latestAt)
  })
}
