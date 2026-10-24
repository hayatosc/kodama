/**
 * drizzle-kit configuration of the management database's D1 schema.
 *
 * @module
 */
import { defineConfig } from 'drizzle-kit'

/** Generates the management migrations applied by `cf d1 migrations` and by the tests. */
export default defineConfig({
  dialect: 'sqlite',
  schema: './drizzle/management/schema.ts',
  out: './drizzle/management/migrations',
})
