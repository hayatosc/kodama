/**
 * Public agent IDs must be v7, and UUID-shaped values cannot bypass the rule as slugs.
 *
 * @module
 */
import { describe, expect, it } from 'vitest'
import { parseAgentId, parseInput, parseMessage, parseRequestId, SlugSchema } from './validation.ts'

const v7 = '019a19ac-0000-7000-8000-00000000000a'
const v4 = '550e8400-e29b-41d4-a716-446655440000'

describe('public agent IDs', () => {
  it('accepts a lowercase canonical v7 ID', () => {
    expect(parseAgentId(v7)).toBe(v7)
  })

  it('rejects v4 and uppercase v7 IDs', () => {
    for (const id of [v4, v7.toUpperCase()]) {
      expect(() => parseAgentId(id)).toThrow('agentId must be a lowercase UUID v7')
    }
  })

  it('keeps UUIDs out of slugs, including rejected v4 IDs', () => {
    for (const id of [v4, v7]) {
      expect(() => parseInput(SlugSchema, id)).toThrow('slug cannot be a UUID')
    }
    expect(parseInput(SlugSchema, 'assistant')).toBe('assistant')
  })
})

describe('messages', () => {
  it('accepts request IDs of 1–128 letters, digits, underscores, or hyphens', () => {
    for (const id of ['a', 'A-z_09', 'r'.repeat(128)]) expect(parseRequestId(id)).toBe(id)
    for (const id of ['', 'r'.repeat(129), 'has space', 'dot.ted', 'slash/ed', 'é']) {
      expect(() => parseRequestId(id)).toThrow('requestId')
    }
  })

  it('accepts content of up to 16,000 characters', () => {
    const content = 'x'.repeat(16_000)
    expect(parseMessage({ requestId: 'max', content })).toEqual({ requestId: 'max', content })
    expect(() => parseMessage({ requestId: 'over', content: `${content}x` })).toThrow('content')
  })
})
