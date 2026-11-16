/** Management D1 constraints and atomic batches for a single-operator installation. @module */
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vite-plus/test'
import insertAgentCredentialRef from '../credentials/sql/insert-agent-credential-ref.sql'
import insertCredential from '../credentials/sql/insert-credential.sql'
import { errorText } from '../lib/errors.ts'
import { prepareQuery, runBatch } from '../lib/reylo.ts'
import { uuidv7 } from '../lib/uuid.ts'
import selectAllAgentCredentialRefs from '../testing/sql/select-all-agent-credential-refs.sql'
import selectAllAgents from '../testing/sql/select-all-agents.sql'
import setAgentVersions from '../testing/sql/set-agent-versions.sql'
import updateAgentStatusReturning from '../testing/sql/update-agent-status-returning.sql'
import { managementDb } from './db.ts'
import insertAgent from './sql/insert-agent.sql'
import insertConfigVersion from './sql/insert-config-version.sql'
import selectAgentById from './sql/select-agent-by-id.sql'

const db = managementDb(env.MANAGEMENT_DB)

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

function registryRow(agentId: string) {
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

function versionRow(agentId: string, version: number) {
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
    const error = await insertConfigVersion
      .run(db, versionRow(uuidv7(), 1))
      .catch((caught: unknown) => caught)
    expect(errorText(error)).toMatch(/FOREIGN KEY constraint failed/)
  })

  it('rejects credential references labeled as a different provider', async () => {
    const agentId = uuidv7()
    const credentialId = uuidv7()
    await insertAgent.run(db, registryRow(agentId))
    await insertCredential.run(db, {
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
    })

    await expect(
      insertAgentCredentialRef.run(db, { agentId, credentialId, provider: 'anthropic' }),
    ).rejects.toThrow()
    expect(await selectAllAgentCredentialRefs.run(db)).toEqual([])

    await insertAgentCredentialRef.run(db, { agentId, credentialId, provider: 'openai' })
    expect(await selectAllAgentCredentialRefs.run(db)).toHaveLength(1)
  })

  it('rolls back the whole batch when a later statement breaks a foreign key', async () => {
    const agentId = uuidv7()
    await expect(
      runBatch(db, [
        prepareQuery(db, insertAgent, registryRow(agentId)),
        prepareQuery(db, insertConfigVersion, versionRow(uuidv7(), 1)),
      ]),
    ).rejects.toThrow()
    expect(await selectAgentById.run(db, { agentId })).toBeNull()
  })

  it('rolls back the whole batch when a later statement breaks a primary key', async () => {
    const agentId = uuidv7()
    await runBatch(db, [
      prepareQuery(db, insertAgent, registryRow(agentId)),
      prepareQuery(db, insertConfigVersion, versionRow(agentId, 1)),
    ])
    await expect(
      runBatch(db, [
        prepareQuery(db, setAgentVersions, { agentId, currentVersion: 2, appliedVersion: 0 }),
        prepareQuery(db, insertConfigVersion, versionRow(agentId, 1)),
      ]),
    ).rejects.toSatisfy((error) => /UNIQUE constraint failed/.test(errorText(error)))
    const row = await selectAgentById.run(db, { agentId })
    expect(row?.currentVersion).toBe(1)
    expect(await selectAllAgents.run(db)).toContainEqual(expect.objectContaining({ agentId }))
  })

  it('returns no row from an UPDATE … RETURNING that matches nothing', async () => {
    const row = await updateAgentStatusReturning.run(db, { agentId: uuidv7(), status: 'paused' })
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
