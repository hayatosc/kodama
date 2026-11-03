/**
 * Storybook for the Kodama UI mockups: components and screens rendered with mock data only.
 *
 * With `STORYBOOK_SINGLE_FILE=1` the preview is built as one self-contained `iframe.html`, which
 * `scripts/storybook-html.ts` turns into a single HTML file that CI uploads for review.
 *
 * @module
 */

import { fileURLToPath } from 'node:url'
import type { StorybookConfig } from '@storybook/sveltekit'
import type { PluginOption } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

const singleFile = process.env.STORYBOOK_SINGLE_FILE === '1'

/**
 * Storybook's module-mocking runtime is a second entry chunk, which stops the preview from being
 * inlined into one file. The stories do not use `sb.mock`, so the single-file build drops it.
 */
const MOCKER_PLUGIN = 'vite:storybook-inject-mocker-runtime'

/** The plugins without the mocker runtime, searching nested plugin arrays. */
function withoutMocker(plugins: PluginOption[]): PluginOption[] {
  return plugins.map((plugin) => {
    if (Array.isArray(plugin)) return withoutMocker(plugin)
    const isMocker =
      typeof plugin === 'object' &&
      plugin !== null &&
      'name' in plugin &&
      plugin.name === MOCKER_PLUGIN
    return isMocker ? false : plugin
  })
}

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
  viteFinal: (viteConfig) => {
    if (!singleFile) return viteConfig
    const cdnFonts = fileURLToPath(new URL('../src/lib/styles/fonts-cdn.css', import.meta.url))
    return {
      ...viteConfig,
      plugins: [...withoutMocker(viteConfig.plugins ?? []), viteSingleFile()],
      resolve: {
        ...viteConfig.resolve,
        alias: [{ find: /^.*\/lib\/styles\/fonts\.css$/, replacement: cdnFonts }],
      },
    }
  },
}

export default config
