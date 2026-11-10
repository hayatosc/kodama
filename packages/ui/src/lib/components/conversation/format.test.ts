/**
 * Tests for the conversation's JSON tokens and durations.
 *
 * @module
 */

import { describe, expect, test } from 'vite-plus/test'
import { formatDuration, jsonTokens } from './format.ts'

/** The tokens joined back into text. */
function text(value: unknown): string {
  return jsonTokens(value)
    .map((token) => token.text)
    .join('')
}

describe('jsonTokens', () => {
  test('keeps a short object on one line, as the design shows it', () => {
    expect(text({ query: 'Durable Objects alarms', limit: 5 })).toBe(
      '{ "query": "Durable Objects alarms", "limit": 5 }',
    )
  })

  test('tells keys from string values, and marks numbers and literals', () => {
    expect(
      jsonTokens({ query: 'a', limit: 5, all: true }).filter((t) => t.kind !== 'plain'),
    ).toEqual([
      { kind: 'key', text: '"query"' },
      { kind: 'string', text: '"a"' },
      { kind: 'key', text: '"limit"' },
      { kind: 'number', text: '5' },
      { kind: 'key', text: '"all"' },
      { kind: 'literal', text: 'true' },
    ])
  })

  test('indents long values and keeps escaped quotes inside one string', () => {
    const value = { message: 'He said "hello" and left a fairly long note behind', n: -1.5 }
    expect(text(value)).toBe(JSON.stringify(value, null, 2))
    expect(jsonTokens(value).find((t) => t.kind === 'string')?.text).toBe(
      JSON.stringify(value.message),
    )
  })

  test('shows empty containers and values JSON cannot encode', () => {
    expect(text({})).toBe('{}')
    expect(text(undefined)).toBe('undefined')
  })
})

describe('formatDuration', () => {
  test('uses tenths under ten seconds, whole seconds under a minute, then minutes', () => {
    expect(formatDuration(400)).toBe('0.4s')
    expect(formatDuration(2_100)).toBe('2.1s')
    expect(formatDuration(38_400)).toBe('38s')
    expect(formatDuration(125_000)).toBe('2m 05s')
    expect(formatDuration(-5)).toBe('0.0s')
  })
})
