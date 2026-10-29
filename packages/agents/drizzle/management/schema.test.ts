/** Fresh management schema parity, defaults and constraints. @module */
import { env } from 'cloudflare:workers'
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { expect, it } from 'vitest'
import { managementDb } from '../../src/management/db.ts'
import * as schema from './schema.ts'

it('stores fresh model defaults and nullable tool aggregate providers', async () => {
  const db = managementDb(env.MANAGEMENT_DB)
  const aggregate = {
    bucket: 'existing',
    day: '2026-10-26',
    chargedAgentId: 'agent',
    provider: 'openai',
    model: 'model',
    actorKind: 'user' as const,
    usageState: 'reported' as const,
    attempts: 2,
    failed: 0,
    rateLimited: 0,
    input: 8,
    output: 4,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 12,
    reasoning: 0,
    cacheWrite1h: 0,
    reasoningReported: 0,
    cacheWrite1hReported: 0,
    costUsd: 0.5,
  }
  await db.insert(schema.usageDaily).values(aggregate)
  expect(await db.select().from(schema.usageDaily)).toMatchObject([
    {
      bucket: 'existing',
      kind: 'model',
      tool: null,
      provider: 'openai',
      model: 'model',
      attempts: 2,
      input: 8,
      output: 4,
      totalTokens: 12,
      costUsd: 0.5,
      api: null,
      countKind: null,
      searchCount: null,
      receivedBytes: null,
    },
  ])
  const tool = await db
    .insert(schema.usageDaily)
    .values({
      ...aggregate,
      bucket: 'tool',
      kind: 'tool',
      provider: null,
      model: null,
    })
    .returning()
  expect(tool).toMatchObject([{ kind: 'tool', provider: null, model: null }])
})

const tables = Object.values(schema).filter((value) => value instanceof SQLiteTable)

it('rejects credential references labeled as a different provider', async () => {
  const db = managementDb(env.MANAGEMENT_DB)
  const agentId = '00000000-0000-7000-8000-000000000001'
  const credentialId = '00000000-0000-7000-8000-000000000002'
  await db.insert(schema.agents).values({
    agentId,
    objectName: agentId,
    kind: 'working',
    displayName: 'Test',
    status: 'active',
    currentVersion: 1,
    createdAt: 1,
    updatedAt: 1,
  })
  await db.insert(schema.credentials).values({
    credentialId,
    kind: 'api_key',
    provider: 'openai',
    ownerId: null,
    status: 'active',
    revision: 1,
    fingerprint: 'test',
    last4: '',
    createdAt: 1,
  })
  await expect(
    db.insert(schema.agentCredentialRefs).values({ agentId, credentialId, provider: 'anthropic' }),
  ).rejects.toThrow()
  expect(await db.select().from(schema.agentCredentialRefs)).toEqual([])
  await db.insert(schema.agentCredentialRefs).values({ agentId, credentialId, provider: 'openai' })
  expect(await db.select().from(schema.agentCredentialRefs)).toHaveLength(1)
})

function declaredColumns(table: SQLiteTable): string[] {
  return getTableConfig(table)
    .columns.map((column) => column.name)
    .sort()
}

it('the newest management migration snapshot has the tables and columns of the Drizzle schema', () => {
  const declared = Object.fromEntries(
    tables.map((table) => [getTableConfig(table).name, declaredColumns(table)]),
  )
  const migrated = Object.fromEntries(
    Object.entries(env.TEST_MANAGEMENT_MIGRATED_COLUMNS).map(([name, columns]) => [
      name,
      [...columns].sort(),
    ]),
  )
  // A mismatch means drizzle/management/schema.ts changed without `nr db:generate:management`.
  expect(migrated).toEqual(declared)
})

it.each(tables.map((table) => [getTableConfig(table).name, table] as const))(
  'the applied management migrations let Drizzle read every column of %s',
  async (_name, table) => {
    await expect(
      managementDb(env.MANAGEMENT_DB).select().from(table).limit(1),
    ).resolves.toBeDefined()
  },
)
