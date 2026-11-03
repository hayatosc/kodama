import { defineConfig } from 'vitest/config'

// Unit tests run in Node; components are exercised in Storybook.
export default defineConfig({
  test: { include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'] },
})
