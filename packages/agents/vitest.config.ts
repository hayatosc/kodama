/**
 * Run the CLI in Node and Worker integration tests in workerd, with shared coverage.
 *
 * @module
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      './vitest.worker.config.ts',
      {
        test: {
          name: 'node',
          environment: 'node',
          // Real OAuth callback tests share the fixed loopback port 1455.
          fileParallelism: false,
          include: [
            'cli/index.test.ts',
            'cli/token.test.ts',
            'cli/migrate.test.ts',
            'src/credentials/local-login.test.ts',
          ],
        },
      },
    ],
    // workerd has no V8 inspector, so both projects use Istanbul instrumentation.
    coverage: {
      provider: 'istanbul',
      include: ['src/**/*.ts', 'cli/**/*.ts'],
      exclude: ['**/*.test.ts', 'src/testing/**'],
      reporter: ['text', 'html'],
    },
  },
})
