/**
 * drizzle-kit configuration of the control database's D1 schema.
 *
 * @module
 */
import { defineConfig } from 'drizzle-kit'

/** Generates the control migrations applied by `cf d1 migrations` and by the tests. */
export default defineConfig({
  dialect: 'sqlite',
  schema: './drizzle/control/schema.ts',
  out: './drizzle/control/migrations',
})
