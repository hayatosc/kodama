import { applyD1Migrations } from 'cloudflare:test'
import type { D1Migration } from 'cloudflare:test'
import { env } from 'cloudflare:workers'

declare global {
  namespace Cloudflare {
    interface Env {
      /** Migrations read by vitest.config.ts; applied once, then skipped as already applied. */
      TEST_MIGRATIONS: D1Migration[]
    }
  }
}

await applyD1Migrations(env.MEMORY_DB, env.TEST_MIGRATIONS)
