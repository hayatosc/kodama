/** Pure, bounded scheduling arithmetic; wall-clock policies use the platform's IANA data.
 * @see docs/agents.md — Scheduled tasks
 * @module
 */
import { Temporal } from '../lib/temporal.ts'
import { cronTime, parseCron, validateCronZone } from './cron.ts'
import * as v from 'valibot'

const date = v.string()
const bounds = { start_at: v.optional(date), end_at: v.optional(date) }
/** Public schedule grammar; cron has exactly five numeric fields and an explicit IANA zone. */
export const ScheduleSchema = v.variant('kind', [
  v.object({ kind: v.literal('once'), run_at: date }),
  v.object({
    kind: v.literal('interval'),
    every_seconds: v.pipe(v.number(), v.integer(), v.minValue(60), v.maxValue(31_536_000)),
    ...bounds,
  }),
  v.object({
    kind: v.literal('cron'),
    expression: v.pipe(v.string(), v.maxLength(256)),
    timezone: v.pipe(v.string(), v.maxLength(100)),
    ...bounds,
  }),
])
/** A caller's rule, before a default anchor is frozen. */
export type Schedule = v.InferOutput<typeof ScheduleSchema>
/** Immutable execution rule; end is exclusive and start is inclusive. */
export type ScheduleSpec =
  | { kind: 'once'; start: number }
  | { kind: 'interval'; start: number; every: number; end?: number }
  | { kind: 'cron'; start: number; expression: string; timezone: string; end?: number }

const YEAR_MS = 365 * 86_400_000

/** Parse an actual calendar date with an explicit UTC offset; never normalize invalid dates. */
export function scheduleDate(value: string): number {
  if (
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
      value,
    )
  )
    throw new TypeError('schedule_date: expected RFC3339 with an explicit offset')
  try {
    return Temporal.Instant.from(value).epochMilliseconds
  } catch {
    throw new TypeError('schedule_date: invalid calendar date')
  }
}

/** Freeze the default anchor once, validate limits, and require at least one occurrence. */
export function normalizeSchedule(input: Schedule, now: number): ScheduleSpec {
  input = v.parse(ScheduleSchema, input)
  let spec: ScheduleSpec
  if (input.kind === 'once') spec = { kind: 'once', start: scheduleDate(input.run_at) }
  else {
    const start =
      input.start_at === undefined
        ? now + (input.kind === 'interval' ? input.every_seconds * 1000 : 1)
        : scheduleDate(input.start_at)
    const end = input.end_at === undefined ? undefined : scheduleDate(input.end_at)
    if (end !== undefined && end <= start) throw new TypeError('schedule_end: must follow start')
    if (input.kind === 'interval')
      spec = {
        kind: 'interval',
        start,
        every: input.every_seconds * 1000,
        ...(end === undefined ? {} : { end }),
      }
    else {
      const expression = input.expression.trim().replace(/\s+/g, ' ')
      parseCron(expression)
      validateCronZone(input.timezone)
      spec = {
        kind: 'cron',
        start,
        expression,
        timezone: input.timezone,
        ...(end === undefined ? {} : { end }),
      }
    }
  }
  if (spec.start <= now || spec.start > now + YEAR_MS)
    throw new TypeError('schedule_start: must be future and within 365 days')
  if (nextAfter(spec, spec.start - 1) === undefined)
    throw new TypeError('schedule_empty: no occurrence within bounds')
  return spec
}

function cronAt(
  spec: Extract<ScheduleSpec, { kind: 'cron' }>,
  at: number,
  forward: boolean,
): number | undefined {
  return cronTime(
    spec.expression,
    spec.timezone,
    forward ? Math.max(spec.start, at + 1) : spec.start,
    Math.min(spec.end === undefined ? Infinity : spec.end - 1, forward ? Infinity : at - 1),
    forward,
  )
}

/** First nominal occurrence strictly after `after`, within immutable start/end bounds. */
export function nextAfter(spec: ScheduleSpec, after: number): number | undefined {
  if (spec.kind === 'once') return spec.start > after ? spec.start : undefined
  if (spec.kind === 'cron') return cronAt(spec, Math.max(after, spec.start - 1), true)
  const at =
    spec.start + Math.max(0, Math.floor((after - spec.start) / spec.every) + 1) * spec.every
  return spec.end === undefined || at < spec.end ? at : undefined
}

/** Latest nominal occurrence at or before `now`, without walking missed occurrences. */
export function latestAtOrBefore(spec: ScheduleSpec, now: number): number | undefined {
  if (now < spec.start) return undefined
  if (spec.kind === 'once') return spec.start
  const upper = Math.min(now, spec.end === undefined ? now : spec.end - 1)
  if (upper < spec.start) return undefined
  if (spec.kind === 'cron') return cronAt(spec, upper + 1, false)
  return spec.start + Math.floor((upper - spec.start) / spec.every) * spec.every
}
