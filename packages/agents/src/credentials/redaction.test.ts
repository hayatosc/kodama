/** Redaction recognizes key patterns and keeps exact values for the object lifetime. @module */
import { expect, it, vi } from 'vitest'
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

it('detects key and JWT shapes embedded after request-ID prefixes', () => {
  for (const prefix of ['prefix_', 'prefix-', 'prefix']) {
    expect(redactSecrets(`${prefix}sk-abcdef123456`)).toBe(`${prefix}[REDACTED]`)
    expect(redactSecrets(`${prefix}eyJabc.def.ghi`)).toBe(`${prefix}[REDACTED]`)
  }
})

it('redacts unselected Google key shapes including prefixed request IDs', () => {
  const key = `AIza${'a'.repeat(35)}`
  expect(redactSecrets(`Provider echoed ${key}`)).toBe('Provider echoed [REDACTED]')
  expect(redactSecrets(`prefix_${key}`)).toBe('prefix_[REDACTED]')
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

it('retains exact values for the instance lifetime, never sharing them with fresh instances', () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(0)
  try {
    const redactor = createRedactor()
    redactor.remember('opaque-provider-secret')
    clock.mockReturnValue(24 * 60 * 60 * 1000)
    expect(redactor.text('opaque-provider-secret')).toBe('[REDACTED]')
    expect(createRedactor().text('opaque-provider-secret')).toBe('opaque-provider-secret')
  } finally {
    clock.mockRestore()
  }
})
