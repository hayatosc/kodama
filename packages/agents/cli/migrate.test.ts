/**
 * Local migrations initialize both databases and preserve data across repeated dev starts.
 *
 * @module
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath, URL } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/d1'
import { migrate } from 'drizzle-orm/d1/migrator'
import { expect, it } from 'vitest'
import { agentConfigVersions, agents, systemSettings } from '../drizzle/management/schema.ts'
import { memoryRecords } from '../drizzle/memory/schema.ts'
import { localDatabases, migrateLocal } from './migrate.ts'

it('upgrades a populated management database without losing agents or versions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kodama-upgrade-'))
  const migrationsFolder = join(directory, 'old-schema')
  const source = fileURLToPath(new URL('../drizzle/management/migrations/', import.meta.url))
  try {
    await mkdir(join(migrationsFolder, 'meta'), { recursive: true })
    await writeFile(
      join(migrationsFolder, '0000_control_registry.sql'),
      await readFile(join(source, '0000_control_registry.sql')),
    )
    await writeFile(
      join(migrationsFolder, 'meta/_journal.json'),
      JSON.stringify({
        entries: [
          {
            idx: 0,
            version: '6',
            when: 1792827234939,
            tag: '0000_control_registry',
            breakpoints: true,
          },
        ],
      }),
    )
    const runtime = localDatabases(directory)
    try {
      const db = drizzle(await runtime.getD1Database('MANAGEMENT_DB'))
      await migrate(db, { migrationsFolder })
      await db
        .insert(agents)
        .values({
          agentId: 'existing-agent',
          objectName: 'existing-agent',
          kind: 'working',
          displayName: 'Existing',
          status: 'active',
          currentVersion: 1,
          createdAt: 1,
          updatedAt: 1,
        })
      await db
        .insert(agentConfigVersions)
        .values({
          agentId: 'existing-agent',
          version: 1,
          settingsJson: '{}',
          schemaVersion: 1,
          createdAt: 1,
        })
    } finally {
      await runtime.dispose()
    }
    await migrateLocal(directory)
    await migrateLocal(directory)
    const reopened = localDatabases(directory)
    try {
      const db = drizzle(await reopened.getD1Database('MANAGEMENT_DB'))
      expect(await db.select({ id: agents.agentId }).from(agents)).toEqual([
        { id: 'existing-agent' },
      ])
      expect(
        await db
          .select({ id: agentConfigVersions.agentId, version: agentConfigVersions.version })
          .from(agentConfigVersions),
      ).toEqual([{ id: 'existing-agent', version: 1 }])
    } finally {
      await reopened.dispose()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)

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
