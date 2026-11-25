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

/** An array of `length` holes, with `values` set at their indexes. */
function sparse(length: number, values: Record<number, unknown>): unknown[] {
  const array: unknown[] = []
  array.length = length
  return Object.assign(array, values)
}

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

  test('prints empty containers, nulls, holes, and what JSON drops as JSON.stringify does', () => {
    expect(text({})).toBe('{}')
    expect(text([])).toBe('[]')
    expect(text({ gone: undefined, kept: null })).toBe('{ "kept": null }')
    expect(text([undefined])).toBe('[null]')
    expect(text(sparse(2, {}))).toBe('[null, null]')
    expect(text(sparse(2, { 1: 1 }))).toBe('[null, 1]')
    expect(text(sparse(2, { 0: 1 }))).toBe('[1, null]')
    expect(text('"quoted"')).toBe('"\\"quoted\\""')
  })
})
