/**
 * Local migrations initialize both databases and preserve data across repeated dev starts.
 *
 * @module
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vite-plus/test'
import { localDatabases, migrateLocal } from './migrate.ts'

it('initializes fresh storage and preserves installation settings after another migration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kodama-migrations-'))
  try {
    await migrateLocal(directory)
    const first = localDatabases(directory)
    try {
      const management = await first.getD1Database('MANAGEMENT_DB')
      const memory = await first.getD1Database('MEMORY_DB')
      const settings = await management
        .prepare('SELECT key, value_json AS valueJson FROM system_settings')
        .all()
      const records = await memory.prepare('SELECT id FROM memory_records').all()
      expect(settings.results).toEqual([])
      expect(records.results).toEqual([])
      await management
        .prepare('INSERT INTO system_settings (key, value_json) VALUES (?, ?)')
        .bind('install_id', '"existing"')
        .run()
    } finally {
      await first.dispose()
    }
    await migrateLocal(directory)
    const reopened = localDatabases(directory)
    try {
      const management = await reopened.getD1Database('MANAGEMENT_DB')
      const settings = await management
        .prepare('SELECT key, value_json AS valueJson FROM system_settings')
        .all()
      expect(settings.results).toEqual([{ key: 'install_id', valueJson: '"existing"' }])
    } finally {
      await reopened.dispose()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
