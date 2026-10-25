/** Log categories never expose exception text or storage bindings. @module */
import { expect, it } from 'vitest'
import { safeFailure } from './errors.ts'

it('omits exception messages and causes from log details', () => {
  expect(safeFailure(new Error('opaque-provider-secret', { cause: new Error('ciphertext') }))).toBe(
    'Error',
  )
  expect(safeFailure(new TypeError('sk-sensitive123456'))).toBe('TypeError')
  expect(safeFailure('opaque-provider-secret')).toBe('Unknown failure')
})
