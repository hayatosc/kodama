/** Atomic cursor ingestion, UTC attribution, separate prices and paginated usage RPC. @module */
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'
import {
  credentials,
  principals,
  usageDaily,
  usageIngestion,
} from '../../drizzle/management/schema.ts'
import { agentService, caller, newAgentId, principalIdOf } from '../testing/management.ts'
import { testCredentialRefs } from '../testing/credentials.ts'
import { usageRecord } from '../testing/usage.ts'
import { managementDb } from './db.ts'
import { ingestUsage, readUsage, usageCheckpoint } from './usage.ts'

const db = managementDb(env.MANAGEMENT_DB)

it('atomically ingests duplicate concurrent pages once, keeping late-day usage and last-used monotonic', async () => {
  const agentId = await newAgentId()
  const credentialId = (await testCredentialRefs()).primary['openai']
  if (!credentialId) throw new Error('Missing test credential')
  const row = usageRecord({ chargedAgentId: agentId, credentialId, credentialKind: 'api_key' })
  const page = { rows: [row], through: 1, more: false }
  await Promise.all([ingestUsage(db, agentId, 0, page, 1), ingestUsage(db, agentId, 0, page, 2)])
  expect((await usageCheckpoint(db, agentId))?.lastSeq).toBe(1)
  const first = await db.select().from(usageDaily).where(eq(usageDaily.chargedAgentId, agentId))
  expect(first).toHaveLength(1)
  expect(first[0]).toMatchObject({ day: '2026-10-26', attempts: 1, totalTokens: 12, costUsd: 0.05 })
  await ingestUsage(
    db,
    agentId,
    1,
    { rows: [{ ...row, seq: 2, startedAt: row.startedAt - 1000 }], through: 2, more: false },
    3,
  )
  await ingestUsage(db, agentId, 0, page, 4)
  expect(
    (await db.select().from(credentials).where(eq(credentials.credentialId, credentialId)).get())
      ?.lastUsedAt,
  ).toBe(row.startedAt)
  expect(
    (await db.select().from(usageDaily).where(eq(usageDaily.chargedAgentId, agentId)).get())
      ?.attempts,
  ).toBe(2)
})

it('separates completeness and subscription reference amounts and supports all stable grouping pages', async () => {
  const agentId = await newAgentId()
  const rows = [
    usageRecord({ seq: 1, chargedAgentId: agentId, credentialId: null, credentialKind: 'api_key' }),
    usageRecord({
      seq: 2,
      chargedAgentId: agentId,
      credentialId: null,
      credentialKind: 'oauth_subscription',
      startedAt: Date.parse('2026-10-27T00:00:00Z'),
    }),
    usageRecord({ seq: 3, chargedAgentId: agentId, usageState: 'partial', status: 'failed' }),
    usageRecord({
      seq: 4,
      chargedAgentId: agentId,
      usageState: 'unknown',
      input: null,
      output: null,
      cacheRead: null,
      cacheWrite: null,
      totalTokens: null,
      totalCost: null,
      status: 'interrupted',
    }),
  ]
  await ingestUsage(db, agentId, 0, { rows, through: 4, more: false }, Date.now())
  const query = {
    agentId,
    from: '2026-10-26',
    to: '2026-10-28',
    groupBy: 'agent',
    limit: 50,
  } as const
  const result = await agentService().usage(await caller(), query)
  expect(result.groups).toHaveLength(1)
  expect(result.groups[0]).toMatchObject({
    attempts: 4,
    unknown: 1,
    reported: {
      attempts: 2,
      totalTokens: 24,
      reasoningReported: 0,
      payAsYouGoCatalogCostUsd: 0.05,
      subscriptionApiEquivalentUsd: 0.05,
    },
    partial: { attempts: 1, totalTokens: 12, unattributedCatalogCostUsd: 0.05 },
  })
  expect(result.freshness.incomplete).toBe(true)
  for (const groupBy of ['day', 'credential', 'model', 'agent'] as const) {
    const all = await readUsage(db, { ...query, groupBy }, Date.now())
    const first = await readUsage(db, { ...query, groupBy, limit: 1 }, Date.now())
    const seen = [...first.groups]
    let cursor = first.nextCursor
    while (cursor) {
      const next = await readUsage(db, { ...query, groupBy, limit: 1, cursor }, Date.now())
      seen.push(...next.groups)
      cursor = next.nextCursor
    }
    expect(seen).toEqual(all.groups)
  }
})

it('rejects invalid ranges and disabled principals without changing usage', async () => {
  const actor = { kind: 'user', externalId: 'usage-disabled@example.test' } as const
  const query = { from: '2026-10-26', to: '2026-10-28', groupBy: 'day' } as const
  for (const invalid of [
    { ...query, from: '2026-02-30' },
    { ...query, to: query.from },
    { ...query, from: '2024-01-01' },
    { ...query, limit: 201 },
  ]) {
    await expect(Promise.resolve(agentService().usage(actor, invalid))).rejects.toThrow()
  }
  await agentService().usage(actor, query)
  await db
    .update(principals)
    .set({ disabledAt: Date.now() })
    .where(eq(principals.principalId, await principalIdOf(actor)))
  await expect(Promise.resolve(agentService().usage(actor, query))).rejects.toThrow()
})

it('rolls back additions and the checkpoint when a statement in the batch fails', async () => {
  const agentId = await newAgentId()
  const first = usageRecord({ chargedAgentId: agentId })
  const rows = [first, usageRecord({ seq: 2, chargedAgentId: agentId, input: NaN })]
  await expect(ingestUsage(db, agentId, 0, { rows, through: 2, more: false }, 1)).rejects.toThrow()
  expect(await usageCheckpoint(db, agentId)).toBeUndefined()
  expect(await db.select().from(usageDaily).where(eq(usageDaily.chargedAgentId, agentId))).toEqual(
    [],
  )
  await ingestUsage(db, agentId, 0, { rows: [first], through: 1, more: false }, 2)
  expect((await usageCheckpoint(db, agentId))?.lastSeq).toBe(1)
})

it('rejects a nonterminal or out-of-order page before writing any checkpoint', async () => {
  const agentId = await newAgentId()
  await expect(
    ingestUsage(
      db,
      agentId,
      0,
      { rows: [usageRecord({ status: 'in_flight' })], through: 1, more: false },
      1,
    ),
  ).rejects.toThrow()
  expect(await usageCheckpoint(db, agentId)).toBeUndefined()
  expect(await db.select().from(usageIngestion).where(eq(usageIngestion.agentId, agentId))).toEqual(
    [],
  )
})
