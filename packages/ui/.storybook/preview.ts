/**
 * Global story setup: the app stylesheet and a light/dark switch on `data-theme`.
 *
 * @module
 */

import '../src/app.css'
import { withThemeByDataAttribute } from '@storybook/addon-themes'
import type { Preview } from '@storybook/sveltekit'

const preview: Preview = {
  decorators: [
    withThemeByDataAttribute({
      themes: { light: 'light', dark: 'dark' },
      defaultTheme: 'light',
      attributeName: 'data-theme',
    }),
  ],
  parameters: {
    // The page background comes from the theme tokens, not Storybook's backgrounds addon.
    backgrounds: { disable: true },
    layout: 'centered',
    a11y: { test: 'error' },
    options: {
      storySort: { order: ['Introduction', 'Foundations', 'Primitives', 'Kodama', 'Screens'] },
    },
  },
}

export default preview
