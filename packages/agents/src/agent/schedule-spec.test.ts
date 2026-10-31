/** Calendar policy regression tests in workerd, including its IANA timezone data. @module */
import { describe, expect, it } from 'vitest'
import { latestAtOrBefore, nextAfter, normalizeSchedule, scheduleDate } from './schedule-spec.ts'

const now = Date.parse('2026-01-01T00:00:00Z')

describe('schedule specifications', () => {
  it('freezes interval anchors without drift and computes long catch-up directly', () => {
    const rule = normalizeSchedule({ kind: 'interval', every_seconds: 3600 }, now)
    expect(nextAfter(rule, now)).toBe(now + 3_600_000)
    expect(nextAfter(rule, now + 3_900_000)).toBe(now + 7_200_000)
    expect(latestAtOrBefore(rule, now + 100_000 * 3_600_000 + 123)).toBe(now + 100_000 * 3_600_000)
  })

  it('honors explicit inclusive starts and exclusive ends', () => {
    const rule = normalizeSchedule(
      {
        kind: 'interval',
        every_seconds: 60,
        start_at: '2026-01-01T00:01:00Z',
        end_at: '2026-01-01T00:03:00Z',
      },
      now,
    )
    expect(nextAfter(rule, now)).toBe(now + 60_000)
    expect(nextAfter(rule, now + 120_000)).toBeUndefined()
    expect(latestAtOrBefore(rule, now + 180_000)).toBe(now + 120_000)
    expect(latestAtOrBefore(rule, now)).toBeUndefined()
  })

  it('runs once and rejects dates that silently normalize or omit timezone', () => {
    const rule = normalizeSchedule({ kind: 'once', run_at: '2026-01-02T09:00:00+09:00' }, now)
    expect(nextAfter(rule, now)).toBe(Date.parse('2026-01-02T00:00:00Z'))
    expect(nextAfter(rule, rule.start)).toBeUndefined()
    expect(scheduleDate('2026-01-02T09:00:00.123+09:00')).toBe(
      Date.parse('2026-01-02T00:00:00.123Z'),
    )
    for (const value of [
      '2026-02-30T09:00:00Z',
      '2026-01-01T09:00:00',
      '2026-01-01T24:00:00Z',
      '2026-01-01T00:00:60Z',
      '2026-01-01T00:00:00+24:00',
    ])
      expect(() => scheduleDate(value)).toThrow()
  })

  it('supports Sunday, multiple daily times, and day 31 without enumerating missed minutes', () => {
    const sunday = normalizeSchedule(
      { kind: 'cron', expression: '0 9 * * 0', timezone: 'Asia/Tokyo' },
      now,
    )
    expect(nextAfter(sunday, now)).toBe(Date.parse('2026-01-04T00:00:00Z'))
    const weekdays = normalizeSchedule(
      { kind: 'cron', expression: '30 9,17 * * 1-5', timezone: 'Asia/Tokyo' },
      now,
    )
    expect(nextAfter(weekdays, now)).toBe(Date.parse('2026-01-01T00:30:00Z'))
    const month = normalizeSchedule(
      { kind: 'cron', expression: '0 9 31 * *', timezone: 'UTC' },
      now,
    )
    expect(nextAfter(month, Date.parse('2026-01-31T09:00:00Z'))).toBe(
      Date.parse('2026-03-31T09:00:00Z'),
    )
    expect(latestAtOrBefore(month, Date.parse('2026-04-01T00:00:00Z'))).toBe(
      Date.parse('2026-03-31T09:00:00Z'),
    )
  })

  it('skips missing wall times and selects only the earlier repeated minute in both directions', () => {
    const spring = normalizeSchedule(
      { kind: 'cron', expression: '30 2 * * *', timezone: 'America/New_York' },
      now,
    )
    expect(nextAfter(spring, Date.parse('2026-03-07T07:30:00Z'))).toBe(
      Date.parse('2026-03-09T06:30:00Z'),
    )
    const fall = normalizeSchedule(
      { kind: 'cron', expression: '30 1 * * *', timezone: 'America/New_York' },
      now,
    )
    expect(nextAfter(fall, Date.parse('2026-11-01T00:00:00Z'))).toBe(
      Date.parse('2026-11-01T05:30:00Z'),
    )
    expect(nextAfter(fall, Date.parse('2026-11-01T05:30:00Z'))).toBe(
      Date.parse('2026-11-02T06:30:00Z'),
    )
    expect(latestAtOrBefore(fall, Date.parse('2026-11-01T07:00:00Z'))).toBe(
      Date.parse('2026-11-01T05:30:00Z'),
    )
  })

  it('selects the latest cron tick after decades without replaying missed occurrences', () => {
    const rule = normalizeSchedule({ kind: 'cron', expression: '* * * * *', timezone: 'UTC' }, now)
    expect(latestAtOrBefore(rule, Date.parse('2126-06-01T23:59:59Z'))).toBe(
      Date.parse('2126-06-01T23:59:00Z'),
    )
    expect(nextAfter(rule, Date.parse('2126-06-01T23:59:59Z'))).toBe(
      Date.parse('2126-06-02T00:00:00Z'),
    )
  })

  it('rejects unsupported cron features and empty calendars', () => {
    for (const expression of ['0 0 9 * * *', '@daily', '0 9 L * *', '0 9 1 * 0', '0 9 30 2 *'])
      expect(() => normalizeSchedule({ kind: 'cron', expression, timezone: 'UTC' }, now)).toThrow()
    expect(() =>
      normalizeSchedule({ kind: 'cron', expression: '* * * * *', timezone: '+09:00' }, now),
    ).toThrow()
  })
})
