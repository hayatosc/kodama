/** Portable unit tests and native CLI tests, without Worker bindings or database setup. @module */
import { defineConfig } from 'vitest/config'

/** Reviewed portable tests; unlisted tests default to the real Workers integration project. */
export const nodeTestFiles = [
  'cli/command.test.ts',
  'cli/index.test.ts',
  'cli/migrate.test.ts',
  'cli/stream.test.ts',
  'cli/token.test.ts',
  'src/agent/cron.test.ts',
  'src/agent/schedule-spec.test.ts',
  'src/credentials/encryption.test.ts',
  'src/credentials/local-login.test.ts',
  'src/credentials/refresh.test.ts',
  'src/lib/*.test.ts',
  'src/memory/extraction/records.test.ts',
  'src/memory/skills.test.ts',
  'src/tools/web/providers/keyless.test.ts',
  'src/tools/web/search-result.test.ts',
  'src/tools/web/search.test.ts',
  'src/tools/web/url.test.ts',
  'src/validation.test.ts',
]

export default defineConfig({
  test: {
    name: 'node',
    environment: 'node',
    // Real OAuth callback tests share the fixed loopback port 1455.
    fileParallelism: false,
    include: nodeTestFiles,
  },
})
