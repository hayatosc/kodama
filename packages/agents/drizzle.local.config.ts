import { defineConfig } from 'drizzle-kit'

/** Generates the migrations of kodama's tables in each Durable Object's own SQLite. */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/storage/local-schema.ts',
  out: './migrations-local',
})
