/**
 * drizzle-kit configuration of the D1 schema.
 *
 * @module
 */
import { defineConfig } from 'drizzle-kit'

/** Generates the D1 migrations applied by `cf d1 migrations` and by the tests. */
export default defineConfig({
  dialect: 'sqlite',
  schema: './drizzle/memory/schema.ts',
  out: './drizzle/memory/migrations',
})
