/** Run UI unit tests in Node; components are exercised in Storybook. @module */
import { defineConfig } from 'vite-plus'

// Unit tests run in Node; components are exercised in Storybook.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
})
