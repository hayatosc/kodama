/**
 * Checks the tool call's duration text and its one-line JSON.
 *
 * @module
 */

import { describe, expect, test } from 'vite-plus/test'
import { formatDuration, formatElapsed, jsonTokens } from './format.js'

describe('formatDuration', () => {
  test('shows tenths under 10 seconds, whole seconds under a minute, then minutes', () => {
    expect(formatDuration(400)).toBe('0.4s')
    expect(formatDuration(2_140)).toBe('2.1s')
    expect(formatDuration(38_000)).toBe('38s')
    expect(formatDuration(65_000)).toBe('1m 05s')
  })
})

describe('formatElapsed', () => {
  test('counts whole seconds', () => {
    expect(formatElapsed(0)).toBe('0s')
    expect(formatElapsed(12_900)).toBe('12s')
    expect(formatElapsed(600_000)).toBe('10m 00s')
  })
})

describe('jsonTokens', () => {
  const text = (value: unknown) =>
    jsonTokens(value)
      .map((token) => token.text)
      .join('')

  test('prints one line that parses back to the same value', () => {
    const value = {
      query: 'Durable Objects alarms',
      limit: 5,
      tags: ['a', 'b'],
      deep: { ok: true },
    }
    expect(text(value)).toBe(
      '{ "query": "Durable Objects alarms", "limit": 5, "tags": ["a", "b"], "deep": { "ok": true } }',
    )
    expect(JSON.parse(text(value))).toEqual(value)
  })

  test('tells keys from string values', () => {
    expect(jsonTokens({ url: 'https://example.com' })).toEqual([
      { kind: 'punctuation', text: '{ ' },
      { kind: 'key', text: '"url"' },
      { kind: 'punctuation', text: ': ' },
      { kind: 'string', text: '"https://example.com"' },
      { kind: 'punctuation', text: ' }' },
    ])
  })

  test('prints empty containers, nulls, and what JSON drops as JSON.stringify does', () => {
    expect(text({})).toBe('{}')
    expect(text([])).toBe('[]')
    expect(text({ gone: undefined, kept: null })).toBe('{ "kept": null }')
    expect(text([undefined])).toBe('[null]')
    expect(text('"quoted"')).toBe('"\\"quoted\\""')
  })
})
