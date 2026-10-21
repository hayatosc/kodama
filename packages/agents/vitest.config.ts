import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

const migrations = await readD1Migrations(`${import.meta.dirname}/migrations`)

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    fsModuleCache: false,
    testTimeout: 15_000,
  },
  plugins: [
    cloudflareTest({
      experimental: { newConfig: true },
      miniflare: {
        bindings: {
          OPENAI_API_KEY: 'test-key',
          ANTHROPIC_API_KEY: '',
          GEMINI_API_KEY: '',
          XAI_API_KEY: 'xai-test-key',
          TEST_MIGRATIONS: migrations,
        },
        // The test runner renames the Worker; bind its local class rather than the production name.
        durableObjects: { AGENTS: { className: 'Agent', useSQLite: true } },
      },
    }),
  ],
})
