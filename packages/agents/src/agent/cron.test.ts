/** Numeric cron grammar and Temporal calendar search in the actual Workers runtime. @module */
import { describe, expect, it } from 'vitest'
import { cronTime, parseCron, validateCronZone } from './cron.ts'

function search(
  expression: string,
  lower: string,
  upper: string,
  forward = true,
  timezone = 'UTC',
) {
  return cronTime(expression, timezone, Date.parse(lower), Date.parse(upper), forward)
}

describe('cron grammar', () => {
  it('expands lists, ranges, wildcard steps and start-to-maximum steps', () => {
    expect(parseCron('5/20 9-17/4 * 1,6-8 0,7')).toEqual({
      minutes: [5, 25, 45],
      hours: [9, 13, 17],
      days: Array.from({ length: 31 }, (_, i) => i + 1),
      months: [1, 6, 7, 8],
      weekdays: [0],
    })
    expect(parseCron('*/15 0 * * 5-7').minutes).toEqual([0, 15, 30, 45])
    expect(parseCron('0 0 * * 5-7').weekdays).toEqual([0, 5, 6])
    expect(parseCron('0,0,1-2 0 * * *').minutes).toEqual([0, 1, 2])
  })

  it.each([
    '60 * * * *',
    '* 24 * * *',
    '* * 0 * *',
    '* * 32 * *',
    '* * * 0 *',
    '* * * 13 *',
    '* * * * 8',
    '*/0 * * * *',
    '*/-2 * * * *',
    '5-3 * * * *',
    '1-2-3 * * * *',
    '1,,2 * * * *',
    '1/2/3 * * * *',
    '1.5 * * * *',
    '+1 * * * *',
    '* * * * MON',
    '@daily',
    '0 0 0 * * *',
    '0 0 1 * 1',
    '0 0 */1 * */1',
    '0 0 L * *',
    '0 0 * * 1#2',
    '0 0 1W * *',
    '*/99999999999999999999 * * * *',
    '',
  ])('rejects invalid or unsupported expression %s', (expression) => {
    expect(() => parseCron(expression)).toThrow('schedule_cron')
  })

  it('accepts named IANA zones but not fixed offsets or unknown zones', () => {
    for (const zone of ['UTC', 'Asia/Tokyo', 'America/New_York', 'Etc/GMT+9'])
      expect(() => validateCronZone(zone)).not.toThrow()
    for (const zone of ['', 'Z', '+09:00', '-0500', 'Not/A_Zone'])
      expect(() => validateCronZone(zone)).toThrow('schedule_timezone')
  })
})

describe('bounded calendar search', () => {
  it('honors inclusive bounds and reverses steps correctly', () => {
    expect(search('*/15 9-17 * * 1-5', '2026-01-02T17:44:59Z', '2026-01-05T09:00:00Z')).toBe(
      Date.parse('2026-01-02T17:45:00Z'),
    )
    expect(
      search('*/15 9-17 * * 1-5', '2026-01-02T17:45:00.001Z', '2026-01-05T09:00:00Z', false),
    ).toBe(Date.parse('2026-01-05T09:00:00Z'))
    expect(
      search('* * * * *', '2026-01-01T12:00:00.001Z', '2026-01-01T12:00:59.999Z'),
    ).toBeUndefined()
    expect(
      search('* * * * *', '2026-01-01T12:00:00.001Z', '2026-01-01T12:00:59.999Z', false),
    ).toBeUndefined()
  })

  it('finds leap dates across the non-leap century and bounds impossible calendars', () => {
    expect(search('0 0 29 2 *', '2096-03-01T00:00:00Z', '2105-01-01T00:00:00Z')).toBe(
      Date.parse('2104-02-29T00:00:00Z'),
    )
    expect(search('0 0 29 2 *', '2095-01-01T00:00:00Z', '2104-02-28T23:59:59Z', false)).toBe(
      Date.parse('2096-02-29T00:00:00Z'),
    )
    expect(search('0 0 30 2 *', '2026-01-01T00:00:00Z', '9999-01-01T00:00:00Z')).toBeUndefined()
  })

  it('handles overlap queries whose local time precedes an already elapsed first occurrence', () => {
    // At 06:15Z the clock is 01:15 EST, but 01:59 EDT has already happened.
    expect(
      search(
        '* 1 * * *',
        '2026-11-01T00:00:00Z',
        '2026-11-01T06:15:00Z',
        false,
        'America/New_York',
      ),
    ).toBe(Date.parse('2026-11-01T05:59:00Z'))
    expect(
      search('* 1 * * *', '2026-11-01T06:15:00Z', '2026-11-02T07:00:00Z', true, 'America/New_York'),
    ).toBe(Date.parse('2026-11-02T06:00:00Z'))
  })

  it('handles half-hour DST transitions and skips missing wall times in reverse too', () => {
    expect(
      search(
        '45 1 * * *',
        '2026-04-04T14:45:00.001Z',
        '2026-04-06T00:00:00Z',
        true,
        'Australia/Lord_Howe',
      ),
    ).toBe(Date.parse('2026-04-05T15:15:00Z'))
    expect(
      search(
        '45 1 * * *',
        '2026-04-04T00:00:00Z',
        '2026-04-04T15:30:00Z',
        false,
        'Australia/Lord_Howe',
      ),
    ).toBe(Date.parse('2026-04-04T14:45:00Z'))
    expect(
      search(
        '15 2 * * *',
        '2026-10-02T16:00:00Z',
        '2026-10-05T00:00:00Z',
        true,
        'Australia/Lord_Howe',
      ),
    ).toBe(Date.parse('2026-10-04T15:15:00Z'))
    expect(
      search(
        '30 2 * * *',
        '2026-03-06T00:00:00Z',
        '2026-03-08T08:00:00Z',
        false,
        'America/New_York',
      ),
    ).toBe(Date.parse('2026-03-07T07:30:00Z'))
  })
})
