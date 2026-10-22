/**
 * drizzle-kit configuration of kodama's tables in each Durable Object's SQLite.
 *
 * @module
 */
import { defineConfig } from 'drizzle-kit'

/** Generates the migrations of kodama's tables in each Durable Object's own SQLite. */
export default defineConfig({
  dialect: 'sqlite',
  schema: './drizzle/durable-object/schema.ts',
  out: './drizzle/durable-object/migrations',
})
