/** Management schema parity, constraints and populated pre-web upgrades. @module */
import { applyD1Migrations } from 'cloudflare:test'
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { env } from 'cloudflare:workers'
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { expect, it } from 'vitest'
import { managementDb } from '../../src/management/db.ts'
import * as schema from './schema.ts'

const legacyUsage = sqliteTable('usage_daily', {
  bucket: text('bucket').primaryKey(),
  day: text('day').notNull(),
  chargedAgentId: text('charged_agent_id').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  actorKind: text('actor_kind').notNull(),
  usageState: text('usage_state').notNull(),
  attempts: integer('attempts').notNull(),
  failed: integer('failed').notNull(),
  rateLimited: integer('rate_limited').notNull(),
  input: integer('input').notNull(),
  output: integer('output').notNull(),
  cacheRead: integer('cache_read').notNull(),
  cacheWrite: integer('cache_write').notNull(),
  totalTokens: integer('total_tokens').notNull(),
  reasoning: integer('reasoning').notNull(),
  cacheWrite1h: integer('cache_write_1h').notNull(),
  reasoningReported: integer('reasoning_reported').notNull(),
  cacheWrite1hReported: integer('cache_write_1h_reported').notNull(),
  costUsd: real('cost_usd').notNull(),
})

it('preserves populated model aggregates and new defaults through the web rebuild', async () => {
  await applyD1Migrations(env.TEST_UPGRADE_DB, env.TEST_MANAGEMENT_MIGRATIONS.slice(0, 3))
  const db = managementDb(env.TEST_UPGRADE_DB)
  await db.insert(legacyUsage).values({
    bucket: 'existing',
    day: '2026-10-26',
    chargedAgentId: 'agent',
    provider: 'openai',
    model: 'model',
    actorKind: 'user',
    usageState: 'reported',
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
  })
  await applyD1Migrations(env.TEST_UPGRADE_DB, env.TEST_MANAGEMENT_MIGRATIONS)
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
