/**
 * Keeps the UI's copy of the design tokens in step with the design system export.
 *
 * @module
 */

import { expect, test } from 'vite-plus/test'
import designTokens from '../../../../../design/tokens.css?raw'
import uiTokens from './tokens.css?raw'

/** The token declarations, from the first rule on: the files differ only in their header. */
function declarations(css: string): string {
  return css.slice(css.indexOf(':root'))
}

test('tokens.css matches design/tokens.css apart from the CDN font imports', () => {
  expect(declarations(uiTokens)).toBe(declarations(designTokens))
})
