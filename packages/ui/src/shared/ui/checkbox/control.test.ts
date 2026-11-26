/**
 * Checks the look Checkbox and RadioGroupItem share.
 *
 * @module
 */

import { expect, test } from 'vite-plus/test'
import { choiceControl } from './control.js'

test('leaves :indeterminate unstyled, so an unanswered radio group stays empty', () => {
  expect(choiceControl).not.toContain('indeterminate:')
})
