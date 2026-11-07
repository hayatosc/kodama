/**
 * Vite+ settings of the workspace: Oxfmt formatting (`vp fmt`) and type-aware Oxlint (`vp lint`).
 *
 * @module
 */
import svelteRecommended from '@rsvelte/oxlint-plugin/recommended.json' with { type: 'json' }
import { defineConfig } from 'vite-plus'

const svelteRules = Object.fromEntries(
  Object.entries(svelteRecommended.rules).map(([name, severity]) => {
    if (severity !== 'error' && severity !== 'warn' && severity !== 'off') {
      throw new TypeError(`Unsupported Svelte rule severity: ${severity}`)
    }
    return [name, severity] as const
  }),
)

export default defineConfig({
  fmt: {
    semi: false,
    singleQuote: true,
    trailingComma: 'all',
    printWidth: 100,
    ignorePatterns: [
      'pnpm-lock.yaml',
      '**/.cloudflare/**',
      '.agents/**',
      '.codex/**',
      '.aws/**',
      '**/.wrangler/**',
    ],
  },
  lint: {
    plugins: ['typescript', 'unicorn', 'oxc'],
    categories: {
      correctness: 'error',
    },
    ignorePatterns: ['**/.cloudflare/**', '**/.wrangler/**'],
    rules: {
      ...svelteRules,
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'drizzle-orm',
              importNames: ['sql'],
              message: 'Use the typed helpers in packages/agents/src/lib/sql.ts.',
            },
          ],
          patterns: ['drizzle-orm/sql', 'drizzle-orm/sql/*'],
        },
      ],
      'typescript/no-explicit-any': 'error',
      'typescript/ban-ts-comment': [
        'error',
        {
          'ts-expect-error': true,
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-check': false,
        },
      ],
      'typescript/consistent-type-assertions': [
        'error',
        {
          assertionStyle: 'never',
        },
      ],
      'typescript/no-unsafe-type-assertion': 'error',
      'typescript/no-unnecessary-type-assertion': 'error',
      'typescript/consistent-type-imports': 'error',
      'typescript/no-floating-promises': 'error',
      'typescript/no-non-null-assertion': 'error',
      'vite-plus/prefer-vite-plus-imports': 'error',
    },
    overrides: [
      {
        files: ['packages/agents/src/lib/sql.ts'],
        rules: {
          'no-restricted-imports': 'off',
        },
      },
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    jsPlugins: [
      '@rsvelte/oxlint-plugin',
      {
        name: 'vite-plus',
        specifier: 'vite-plus/oxlint-plugin',
      },
    ],
  },
})
