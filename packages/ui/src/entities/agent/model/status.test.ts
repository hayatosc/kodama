/**
 * Checks how lifecycle states map onto run states.
 *
 * @module
 */

import { expect, test } from 'vite-plus/test'
import { runStateOf } from './status.js'

test('lifecycle states map onto run states as the design lists them', () => {
  expect(runStateOf('active')).toBe('live')
  expect(runStateOf('provisioning')).toBe('running')
  expect(runStateOf('pausing')).toBe('running')
  expect(runStateOf('paused')).toBe('paused')
  expect(runStateOf('archived')).toBe('archived')
  expect(runStateOf('deleted')).toBe('archived')
  expect(runStateOf('deleting')).toBe('error')
})
