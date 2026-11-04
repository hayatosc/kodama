/**
 * Run portable units and the CLI in Node, and Worker integration tests in workerd.
 *
 * @module
 */
import { defineConfig } from 'vitest/config'
import { isolatedWorkerdProject, sharedWorkerdProject } from './vitest.worker.config.ts'

export default defineConfig({
  test: {
    projects: [sharedWorkerdProject, isolatedWorkerdProject, './vitest.node.config.ts'],
    // workerd has no V8 inspector, so both projects use Istanbul instrumentation.
    coverage: {
      provider: 'istanbul',
      include: ['src/**/*.ts', 'cli/**/*.ts'],
      exclude: ['**/*.test.ts', 'src/testing/**'],
      reporter: ['text', 'html'],
    },
  },
})
