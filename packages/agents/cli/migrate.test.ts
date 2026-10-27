/**
 * Local migrations initialize both databases and preserve data across repeated dev starts.
 *
 * @module
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/d1'
import { expect, it } from 'vitest'
import { systemSettings } from '../drizzle/management/schema.ts'
import { memoryRecords } from '../drizzle/memory/schema.ts'
import { localDatabases, migrateLocal } from './migrate.ts'

it('initializes fresh storage and preserves installation settings after another migration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kodama-migrations-'))
  try {
    await migrateLocal(directory)
    const first = localDatabases(directory)
    try {
      const management = drizzle(await first.getD1Database('MANAGEMENT_DB'))
      const memory = drizzle(await first.getD1Database('MEMORY_DB'))
      expect(await management.select().from(systemSettings)).toEqual([])
      expect(await memory.select().from(memoryRecords)).toEqual([])
      await management.insert(systemSettings).values({ key: 'install_id', valueJson: '"existing"' })
    } finally {
      await first.dispose()
    }
    await migrateLocal(directory)
    const reopened = localDatabases(directory)
    try {
      const management = drizzle(await reopened.getD1Database('MANAGEMENT_DB'))
      expect(await management.select().from(systemSettings)).toEqual([
        { key: 'install_id', valueJson: '"existing"' },
      ])
    } finally {
      await reopened.dispose()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
