/** Bounded five-field cron parsing and Gregorian calendar search using Temporal.
 * @see docs/agents.md — Scheduled tasks
 * @module
 */
import { Temporal } from '../lib/temporal.ts'

/** Sorted allowed values; Sunday is normalized to zero after expanding ranges and steps. */
export interface CronFields {
  minutes: number[]
  hours: number[]
  days: number[]
  months: number[]
  weekdays: number[]
}

function fieldValues(field: string, minimum: number, maximum: number): number[] {
  const values = new Set<number>()
  for (const part of field.split(',')) {
    const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part)
    if (!match?.[1]) throw new TypeError('schedule_cron: invalid field')
    const base = match[1]
    const step = match[2] === undefined ? 1 : Number(match[2])
    const [first, last] = base.split('-')
    const start = base === '*' ? minimum : Number(first)
    const end =
      base === '*'
        ? maximum
        : last === undefined
          ? match[2] === undefined
            ? start
            : maximum
          : Number(last)
    if (
      !Number.isSafeInteger(step) ||
      step < 1 ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < minimum ||
      end > maximum ||
      start > end
    )
      throw new TypeError('schedule_cron: field outside bounds')
    for (let value = start; value <= end; value += step) values.add(value)
  }
  return [...values].sort((a, b) => a - b)
}

/** Parse only numeric five-field cron; at least one day field must be the literal wildcard. */
export function parseCron(expression: string): CronFields {
  const fields = expression.trim().split(/\s+/)
  const [minute, hour, day, month, weekday] = fields
  if (
    expression.length > 256 ||
    fields.length !== 5 ||
    minute === undefined ||
    hour === undefined ||
    day === undefined ||
    month === undefined ||
    weekday === undefined ||
    (day !== '*' && weekday !== '*')
  )
    throw new TypeError('schedule_cron: five numeric fields; day-of-month or day-of-week must be *')
  return {
    minutes: fieldValues(minute, 0, 59),
    hours: fieldValues(hour, 0, 23),
    days: fieldValues(day, 1, 31),
    months: fieldValues(month, 1, 12),
    weekdays: [...new Set(fieldValues(weekday, 0, 7).map((day) => day % 7))].sort((a, b) => a - b),
  }
}

/** Require a named zone backed by platform IANA data, not a fixed numeric offset. */
export function validateCronZone(timezone: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(timezone))
    throw new TypeError('schedule_timezone: expected an IANA zone')
  try {
    Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(timezone)
  } catch {
    throw new TypeError('schedule_timezone: expected an IANA zone')
  }
}

/** Find an inclusive first/last match in at most eight years, without replaying missed ticks.
 * Calendar days are searched, not elapsed minutes. Only allowed hours/minutes on matching dates
 * are converted; even an every-minute rule examines at most 1,440 candidates on a boundary date.
 * Both directions use the earlier instant for overlaps and discard non-existent wall times.
 */
export function cronTime(
  expression: string,
  timezone: string,
  lower: number,
  upper: number,
  forward: boolean,
): number | undefined {
  const horizon = 8 * 366 * 86_400_000
  if (forward) upper = Math.min(upper, lower + horizon)
  else lower = Math.max(lower, upper - horizon)
  if (lower > upper) return undefined
  const fields = parseCron(expression)
  const first = Temporal.Instant.fromEpochMilliseconds(forward ? lower : upper)
    .toZonedDateTimeISO(timezone)
    .toPlainDate()
  const last = Temporal.Instant.fromEpochMilliseconds(forward ? upper : lower)
    .toZonedDateTimeISO(timezone)
    .toPlainDate()
  const direction = forward ? 1 : -1
  const hours = forward ? fields.hours : fields.hours.toReversed()
  const minutes = forward ? fields.minutes : fields.minutes.toReversed()
  for (
    let date = first;
    Temporal.PlainDate.compare(date, last) * direction <= 0;
    date = date.add({ days: direction })
  ) {
    if (
      !fields.months.includes(date.month) ||
      !fields.days.includes(date.day) ||
      !fields.weekdays.includes(date.dayOfWeek % 7)
    )
      continue
    for (const hour of hours) {
      for (const minute of minutes) {
        const local = date.toPlainDateTime({ hour, minute })
        const zoned = local.toZonedDateTime(timezone, { disambiguation: 'earlier' })
        // In a gap, Temporal shifts the wall time; reject that shifted candidate instead.
        if (!zoned.toPlainDateTime().equals(local)) continue
        const at = zoned.epochMilliseconds
        if (at >= lower && at <= upper) return at
      }
    }
  }
  return undefined
}
