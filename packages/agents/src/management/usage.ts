/** Atomic daily ingestion and usage reads in the management database. @module */
import { and, eq, exists, asc, gt, gte, lt, isNull, or, sum, count, min } from 'drizzle-orm'
import type { AnyColumn } from 'drizzle-orm'
import { sumWhen, groupKey, increment, literal } from '../lib/sql.ts'
import { agents } from '../../drizzle/management/schema.ts'
import type { UsageQuery } from '../protocol.ts'
import {
  usageDaily as daily,
  usageIngestion as ingestion,
} from '../../drizzle/management/schema.ts'
import { lastUsedStatement } from '../credentials/usage.ts'
import type { UsagePage, UsageRow } from '../storage/usage.ts'
import type { ManagementDb } from './db.ts'

function amounts(state: 'reported' | 'partial') {
  const sum = (value: AnyColumn<{ data: number }>) => sumWhen(eq(daily.usageState, state), value)
  return {
    attempts: sum(daily.attempts),
    input: sum(daily.input),
    output: sum(daily.output),
    cacheRead: sum(daily.cacheRead),
    cacheWrite: sum(daily.cacheWrite),
    totalTokens: sum(daily.totalTokens),
    reasoning: sum(daily.reasoning),
    cacheWrite1h: sum(daily.cacheWrite1h),
    reasoningReported: sum(daily.reasoningReported),
    cacheWrite1hReported: sum(daily.cacheWrite1hReported),
    payAsYouGoCatalogCostUsd: sumWhen(
      and(eq(daily.usageState, state), eq(daily.credentialKind, 'api_key')),
      daily.costUsd,
    ),
    subscriptionApiEquivalentUsd: sumWhen(
      and(eq(daily.usageState, state), eq(daily.credentialKind, 'oauth_subscription')),
      daily.costUsd,
    ),
    unattributedCatalogCostUsd: sumWhen(
      and(eq(daily.usageState, state), isNull(daily.credentialKind)),
      daily.costUsd,
    ),
  }
}

/** Stable group-key pagination; incomplete data never appears as a current measured zero. */
export async function readUsage(
  db: ManagementDb,
  query: UsageQuery & { limit: number },
  now: number,
) {
  const key =
    query.groupBy === 'day'
      ? groupKey(daily.day)
      : query.groupBy === 'agent'
        ? groupKey(daily.chargedAgentId)
        : query.groupBy === 'credential'
          ? groupKey(daily.credentialId, daily.credentialKind)
          : groupKey(daily.provider, daily.model)
  const rows = await db
    .select({
      key: key.as('group_key'),
      attempts: sum(daily.attempts).mapWith(Number),
      failed: sum(daily.failed).mapWith(Number),
      rateLimited: sum(daily.rateLimited).mapWith(Number),
      unknown: sumWhen(eq(daily.usageState, 'unknown'), daily.attempts),
      notApplicable: sumWhen(eq(daily.usageState, 'not_applicable'), daily.attempts),
      reported: amounts('reported'),
      partial: amounts('partial'),
    })
    .from(daily)
    .where(
      and(
        gte(daily.day, query.from),
        lt(daily.day, query.to),
        query.agentId ? eq(daily.chargedAgentId, query.agentId) : undefined,
        query.cursor ? gt(key, query.cursor) : undefined,
      ),
    )
    .groupBy(key)
    .orderBy(asc(key))
    .limit(query.limit + 1)
  const freshness = await db
    .select({
      sources: count(),
      pendingSources: sumWhen(
        or(
          isNull(ingestion.updatedAt),
          lt(ingestion.updatedAt, now - 26 * 3_600_000),
          eq(ingestion.caughtUp, false),
        ),
        1,
      ),
      oldestCheckedAt: min(ingestion.updatedAt),
    })
    .from(agents)
    .leftJoin(ingestion, eq(agents.agentId, ingestion.agentId))
    .get()
  const groups = rows.slice(0, query.limit)
  return {
    groups,
    nextCursor: rows.length > query.limit ? (groups.at(-1)?.key ?? null) : null,
    freshness: {
      ...freshness,
      checkedAt: now,
      incomplete:
        (freshness?.pendingSources ?? 0) > 0 ||
        groups.some((row) => row.unknown > 0 || row.partial.attempts > 0),
    },
  }
}

/** Read the durable cursor, including after an uncertain commit or lost acknowledgment. */
export async function usageCheckpoint(db: ManagementDb, agentId: string) {
  return db.select().from(ingestion).where(eq(ingestion.agentId, agentId)).get()
}

function bucketStatement(db: ManagementDb, row: UsageRow, agentId: string, after: number) {
  const day = new Date(row.startedAt).toISOString().slice(0, 10)
  const bucket = JSON.stringify([
    day,
    row.chargedAgentId,
    row.credentialId,
    row.credentialKind,
    row.provider,
    row.model,
    row.actorKind,
    row.usageState,
  ])
  const counts = {
    attempts: literal(1),
    failed: literal(
      row.status === 'failed' || row.status === 'aborted' || row.status === 'interrupted' ? 1 : 0,
    ),
    rateLimited: literal(row.rateLimited ? 1 : 0),
    input: literal(row.input ?? 0),
    output: literal(row.output ?? 0),
    cacheRead: literal(row.cacheRead ?? 0),
    cacheWrite: literal(row.cacheWrite ?? 0),
    totalTokens: literal(row.totalTokens ?? 0),
    reasoning: literal(row.reasoning ?? 0),
    cacheWrite1h: literal(row.cacheWrite1h ?? 0),
    reasoningReported: literal(row.reasoning === null ? 0 : 1),
    cacheWrite1hReported: literal(row.cacheWrite1h === null ? 0 : 1),
    costUsd: literal(row.totalCost ?? 0),
  }
  return db
    .insert(daily)
    .select(
      db
        .select({
          bucket: literal(bucket).as('bucket'),
          day: literal(day).as('day'),
          chargedAgentId: literal(row.chargedAgentId).as('charged_agent_id'),
          credentialId: literal(row.credentialId).as('credential_id'),
          credentialKind: literal(row.credentialKind).as('credential_kind'),
          provider: literal(row.provider).as('provider'),
          model: literal(row.model).as('model'),
          actorKind: literal(row.actorKind).as('actor_kind'),
          usageState: literal(row.usageState).as('usage_state'),
          attempts: counts.attempts.as('attempts'),
          failed: counts.failed.as('failed'),
          rateLimited: counts.rateLimited.as('rate_limited'),
          input: counts.input.as('input'),
          output: counts.output.as('output'),
          cacheRead: counts.cacheRead.as('cache_read'),
          cacheWrite: counts.cacheWrite.as('cache_write'),
          totalTokens: counts.totalTokens.as('total_tokens'),
          reasoning: counts.reasoning.as('reasoning'),
          cacheWrite1h: counts.cacheWrite1h.as('cache_write_1h'),
          reasoningReported: counts.reasoningReported.as('reasoning_reported'),
          cacheWrite1hReported: counts.cacheWrite1hReported.as('cache_write_1h_reported'),
          costUsd: counts.costUsd.as('cost_usd'),
        })
        .from(ingestion)
        .where(and(eq(ingestion.agentId, agentId), eq(ingestion.lastSeq, after))),
    )
    .onConflictDoUpdate({
      target: daily.bucket,
      set: {
        attempts: increment(daily.attempts, 1),
        failed: increment(daily.failed, counts.failed),
        rateLimited: increment(daily.rateLimited, counts.rateLimited),
        input: increment(daily.input, counts.input),
        output: increment(daily.output, counts.output),
        cacheRead: increment(daily.cacheRead, counts.cacheRead),
        cacheWrite: increment(daily.cacheWrite, counts.cacheWrite),
        totalTokens: increment(daily.totalTokens, counts.totalTokens),
        reasoning: increment(daily.reasoning, counts.reasoning),
        cacheWrite1h: increment(daily.cacheWrite1h, counts.cacheWrite1h),
        reasoningReported: increment(daily.reasoningReported, counts.reasoningReported),
        cacheWrite1hReported: increment(daily.cacheWrite1hReported, counts.cacheWrite1hReported),
        costUsd: increment(daily.costUsd, counts.costUsd),
      },
    })
}

/** A bounded atomic batch: additions are guarded by the old cursor, which advances last. */
export async function ingestUsage(
  db: ManagementDb,
  agentId: string,
  after: number,
  page: UsagePage,
  now: number,
): Promise<void> {
  if (
    page.rows.length > 20 ||
    page.through < after ||
    page.through !== (page.rows.at(-1)?.seq ?? after)
  )
    throw new TypeError('Invalid usage ingestion page')
  let previous = after
  for (const row of page.rows) {
    if (row.seq <= previous || row.status === 'in_flight')
      throw new TypeError('Invalid terminal usage prefix')
    previous = row.seq
  }
  const guard = exists(
    db
      .select({ seq: ingestion.lastSeq })
      .from(ingestion)
      .where(and(eq(ingestion.agentId, agentId), eq(ingestion.lastSeq, after))),
  )
  await db.batch([
    db.insert(ingestion).values({ agentId, updatedAt: 0 }).onConflictDoNothing(),
    ...page.rows.map((row) => bucketStatement(db, row, agentId, after)),
    ...page.rows.flatMap((row) =>
      row.credentialId === null
        ? []
        : [lastUsedStatement(db, row.credentialId, row.startedAt, guard)],
    ),
    db
      .update(ingestion)
      .set({ lastSeq: page.through, updatedAt: now, caughtUp: !page.more })
      .where(and(eq(ingestion.agentId, agentId), eq(ingestion.lastSeq, after))),
  ])
}
