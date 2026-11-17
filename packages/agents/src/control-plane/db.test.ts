/** Management D1 constraints and atomic batches for a single-operator installation. @module */
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vite-plus/test'
import { insertAgentCredentialRefStatement } from '../credentials/grants.repository.ts'
import { insertCredentialStatement } from '../credentials/vault.repository.ts'
import { errorText } from '../lib/errors.ts'
import { runBatch } from '../lib/reylo.ts'
import { uuidv7 } from '../lib/uuid.ts'
import {
  listAllAgentCredentialRefs,
  listAllAgents,
  updateAgentStatusReturning,
  updateAgentVersionsStatement,
} from '../testing/test-db.repository.ts'
import { managementDb } from './db.ts'
import { findAgentById, insertAgentStatement } from './registry.repository.ts'
import type { InsertAgentParams } from './registry.repository.ts'
import { insertConfigVersionStatement } from './versions.repository.ts'
import type { InsertConfigVersionParams } from './versions.repository.ts'

const db = managementDb(env.MANAGEMENT_DB)

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

function registryRow(agentId: string): InsertAgentParams {
  return {
    agentId,
    objectName: agentId,
    kind: 'working',
    displayName: 'test',
    slug: null,
    status: 'active',
    currentVersion: 1,
    createdAt: 0,
    updatedAt: 0,
  }
}

function versionRow(agentId: string, version: number): InsertConfigVersionParams {
  return {
    agentId,
    version,
    settingsJson: '{}',
    schemaVersion: 1,
    source: 'system',
    comment: null,
    createdAt: 0,
  }
}

// The management database keeps references consistent with foreign keys and one batch() per change;
// these are the D1 behaviors that relies on. Run them again on D1 emulator or runtime upgrades.
describe('D1 behavior the management database relies on', () => {
  it('enforces foreign keys by default', async () => {
    const error = await insertConfigVersionStatement(db, versionRow(uuidv7(), 1))
      .run()
      .catch((caught: unknown) => caught)
    expect(errorText(error)).toMatch(/FOREIGN KEY constraint failed/)
  })

  it('rejects credential references labeled as a different provider', async () => {
    const agentId = uuidv7()
    const credentialId = uuidv7()
    await insertAgentStatement(db, registryRow(agentId)).run()
    await insertCredentialStatement(db, {
      credentialId,
      kind: 'api_key',
      purpose: 'model_provider',
      provider: 'openai',
      status: 'active',
      revision: 1,
      ciphertext: '',
      iv: '',
      wrappedDek: '',
      wrapIv: '',
      fingerprint: 'test',
      last4: '',
      createdAt: 1,
      expiresAt: null,
    }).run()

    await expect(
      insertAgentCredentialRefStatement(db, { agentId, credentialId, provider: 'anthropic' }).run(),
    ).rejects.toThrow()
    expect(await listAllAgentCredentialRefs(db)).toEqual([])

    await insertAgentCredentialRefStatement(db, { agentId, credentialId, provider: 'openai' }).run()
    expect(await listAllAgentCredentialRefs(db)).toHaveLength(1)
  })

  it('rolls back the whole batch when a later statement breaks a foreign key', async () => {
    const agentId = uuidv7()
    await expect(
      runBatch(db, [
        insertAgentStatement(db, registryRow(agentId)),
        insertConfigVersionStatement(db, versionRow(uuidv7(), 1)),
      ]),
    ).rejects.toThrow()
    expect(await findAgentById(db, agentId)).toBeUndefined()
  })

  it('rolls back the whole batch when a later statement breaks a primary key', async () => {
    const agentId = uuidv7()
    await runBatch(db, [
      insertAgentStatement(db, registryRow(agentId)),
      insertConfigVersionStatement(db, versionRow(agentId, 1)),
    ])
    await expect(
      runBatch(db, [
        updateAgentVersionsStatement(db, { agentId, currentVersion: 2, appliedVersion: 0 }),
        insertConfigVersionStatement(db, versionRow(agentId, 1)),
      ]),
    ).rejects.toSatisfy((error) => /UNIQUE constraint failed/.test(errorText(error)))
    const row = await findAgentById(db, agentId)
    expect(row?.currentVersion).toBe(1)
    expect(await listAllAgents(db)).toContainEqual(expect.objectContaining({ agentId }))
  })

  it('returns no row from an UPDATE … RETURNING that matches nothing', async () => {
    const row = await updateAgentStatusReturning(db, { agentId: uuidv7(), status: 'paused' })
    expect(row).toBeNull()
  })

  it('applies every management table and column declared in the SQL migrations', async () => {
    const { results: tables } = await db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations' ORDER BY name",
      )
      .all<{ name: string }>()
    const expectedTables = Object.keys(env.TEST_MANAGEMENT_MIGRATED_COLUMNS).sort(byCodeUnit)
    expect(tables.map((row) => row.name).sort(byCodeUnit)).toEqual(expectedTables)

    for (const [table, columns] of Object.entries(env.TEST_MANAGEMENT_MIGRATED_COLUMNS)) {
      const escapedTable = table.replaceAll('"', '""')
      const columnList = columns.map((col) => `"${col.replaceAll('"', '""')}"`).join(', ')
      await expect(
        db.prepare(`SELECT ${columnList} FROM "${escapedTable}" LIMIT 1`).all(),
      ).resolves.toBeDefined()
    }
  })
})
