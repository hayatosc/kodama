/**
 * What an agent did while nobody was watching, as the activity feed lists it, and how the feed
 * writes each event's time.
 *
 * @module
 */

import { calendarDaysBetween } from '#shared/lib/dates.js'

/** The kinds of event the feed shows (design/components/ActivityFeed). */
export type ActivityKind = 'alarm' | 'cron' | 'peer' | 'memory' | 'config' | 'run' | 'error'

/** One event in the feed. */
export type ActivityItem = {
  /** Unique within the feed. */
  id: string
  /** When it happened, as an ISO-8601 time. */
  at: string
  kind: ActivityKind
  /** The part in bold, such as 「朝のまとめを作成中」 or the peer agent's name. */
  subject: string
  /** The muted text after the subject, such as 「· 論文3件」. */
  detail?: string
  /** Still in progress: its node is the running dot. */
  active?: boolean
}

/**
 * An event's time as the feed writes it: `09:00` today, 「昨日」 yesterday, and `10/28` before
 * that, in the device's time zone.
 */
export function formatActivityTime(at: string, now: Date): string {
  const time = new Date(at)
  const days = calendarDaysBetween(time, now)
  if (days === 0) {
    return `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
  }
  if (days === 1) return '昨日'
  return `${time.getMonth() + 1}/${time.getDate()}`
}
