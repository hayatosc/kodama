/**
 * Storybook for the Kodama UI mockups: components and screens rendered with mock data only.
 *
 * @module
 */

import type { StorybookConfig } from '@storybook/sveltekit'

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(ts|svelte)'],
  addons: [
    '@storybook/addon-svelte-csf',
    '@storybook/addon-docs',
    '@storybook/addon-a11y',
    '@storybook/addon-themes',
  ],
  framework: '@storybook/sveltekit',
  core: { disableTelemetry: true },
}

export default config
