/** Redaction recognizes key patterns and expires exact-value knowledge with the cache. @module */
import { expect, it } from 'vitest'
import { createRedactor, redactData, redactSecrets } from './redaction.ts'

it('removes known values, API-key shapes and JWTs without changing ordinary prose', () => {
  expect(
    redactSecrets(
      'known=opaque-provider-secret sk-test123456 xai-123456789 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
      ['opaque-provider-secret'],
    ),
  ).toBe('known=[REDACTED] [REDACTED] [REDACTED] [REDACTED]')
  expect(redactSecrets('A useful ordinary sentence.')).toBe('A useful ordinary sentence.')
})

it('redacts nested protocol values without mutating the input', () => {
  const input = { content: [{ text: 'sk-secret123456' }], detail: 'xai-secret123456' }
  expect(redactData(input)).toEqual({ content: [{ text: '[REDACTED]' }], detail: '[REDACTED]' })
  expect(input.content[0]?.text).toBe('sk-secret123456')
})

it('drops secret-bearing keys rather than overwriting safe keys or mutating the input', () => {
  const input = {
    nested: { 'sk-secret123456': 'one', 'sk-another123456': 'two', '[REDACTED]': 'safe' },
  }
  expect(redactData(input)).toEqual({ nested: { '[REDACTED]': 'safe' } })
  expect(input.nested['sk-secret123456']).toBe('one')
})

it('retains exact values for at most five minutes', () => {
  let now = 0
  const redactor = createRedactor(() => now)
  redactor.remember('opaque-provider-secret')
  expect(redactor.text('opaque-provider-secret')).toBe('[REDACTED]')
  now = 300_000
  expect(redactor.text('opaque-provider-secret')).toBe('opaque-provider-secret')
})
