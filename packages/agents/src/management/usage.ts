/** Atomic daily ingestion and usage reads in the management database. @module */
import { and, eq, exists, sql, asc, gt, gte, lt } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
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
  const sum = (value: SQL) =>
    sql<number>`coalesce(sum(case when ${daily.usageState} = ${state} then ${value} else 0 end), 0)`.mapWith(
      Number,
    )
  return {
    attempts: sum(sql`${daily.attempts}`),
    input: sum(sql`${daily.input}`),
    output: sum(sql`${daily.output}`),
    cacheRead: sum(sql`${daily.cacheRead}`),
    cacheWrite: sum(sql`${daily.cacheWrite}`),
    totalTokens: sum(sql`${daily.totalTokens}`),
    reasoning: sum(sql`${daily.reasoning}`),
    cacheWrite1h: sum(sql`${daily.cacheWrite1h}`),
    reasoningReported: sum(sql`${daily.reasoningReported}`),
    cacheWrite1hReported: sum(sql`${daily.cacheWrite1hReported}`),
    payAsYouGoCatalogCostUsd: sum(
      sql`case when ${daily.credentialKind} = 'api_key' then ${daily.costUsd} else 0 end`,
    ),
    subscriptionApiEquivalentUsd: sum(
      sql`case when ${daily.credentialKind} = 'oauth_subscription' then ${daily.costUsd} else 0 end`,
    ),
    unattributedCatalogCostUsd: sum(
      sql`case when ${daily.credentialKind} is null then ${daily.costUsd} else 0 end`,
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
      ? sql<string>`json_array(${daily.day})`
      : query.groupBy === 'agent'
        ? sql<string>`json_array(${daily.chargedAgentId})`
        : query.groupBy === 'credential'
          ? sql<string>`json_array(${daily.credentialId}, ${daily.credentialKind})`
          : sql<string>`json_array(${daily.provider}, ${daily.model})`
  const rows = await db
    .select({
      key: key.as('group_key'),
      attempts: sql<number>`sum(${daily.attempts})`.mapWith(Number),
      failed: sql<number>`sum(${daily.failed})`.mapWith(Number),
      rateLimited: sql<number>`sum(${daily.rateLimited})`.mapWith(Number),
      unknown:
        sql<number>`sum(case when ${daily.usageState} = 'unknown' then ${daily.attempts} else 0 end)`.mapWith(
          Number,
        ),
      notApplicable:
        sql<number>`sum(case when ${daily.usageState} = 'not_applicable' then ${daily.attempts} else 0 end)`.mapWith(
          Number,
        ),
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
      sources: sql<number>`count(*)`.mapWith(Number),
      pendingSources:
        sql<number>`coalesce(sum(case when ${ingestion.updatedAt} is null or ${ingestion.updatedAt} < ${now - 26 * 3_600_000} or ${ingestion.caughtUp} = 0 then 1 else 0 end), 0)`.mapWith(
          Number,
        ),
      oldestCheckedAt: sql<number | null>`min(${ingestion.updatedAt})`,
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
    attempts: sql<number>`1`,
    failed: sql<number>`${row.status === 'failed' || row.status === 'aborted' || row.status === 'interrupted' ? 1 : 0}`,
    rateLimited: sql<number>`${row.rateLimited ? 1 : 0}`,
    input: sql<number>`${row.input ?? 0}`,
    output: sql<number>`${row.output ?? 0}`,
    cacheRead: sql<number>`${row.cacheRead ?? 0}`,
    cacheWrite: sql<number>`${row.cacheWrite ?? 0}`,
    totalTokens: sql<number>`${row.totalTokens ?? 0}`,
    reasoning: sql<number>`${row.reasoning ?? 0}`,
    cacheWrite1h: sql<number>`${row.cacheWrite1h ?? 0}`,
    reasoningReported: sql<number>`${row.reasoning === null ? 0 : 1}`,
    cacheWrite1hReported: sql<number>`${row.cacheWrite1h === null ? 0 : 1}`,
    costUsd: sql<number>`${row.totalCost ?? 0}`,
  }
  return db
    .insert(daily)
    .select(
      db
        .select({
          bucket: sql<string>`${bucket}`.as('bucket'),
          day: sql<string>`${day}`.as('day'),
          chargedAgentId: sql<string>`${row.chargedAgentId}`.as('charged_agent_id'),
          credentialId: sql<string | null>`${row.credentialId}`.as('credential_id'),
          credentialKind: sql<typeof row.credentialKind>`${row.credentialKind}`.as(
            'credential_kind',
          ),
          provider: sql<string>`${row.provider}`.as('provider'),
          model: sql<string>`${row.model}`.as('model'),
          actorKind: sql<typeof row.actorKind>`${row.actorKind}`.as('actor_kind'),
          usageState: sql<typeof row.usageState>`${row.usageState}`.as('usage_state'),
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
        attempts: sql`${daily.attempts} + 1`,
        failed: sql`${daily.failed} + ${counts.failed}`,
        rateLimited: sql`${daily.rateLimited} + ${counts.rateLimited}`,
        input: sql`${daily.input} + ${counts.input}`,
        output: sql`${daily.output} + ${counts.output}`,
        cacheRead: sql`${daily.cacheRead} + ${counts.cacheRead}`,
        cacheWrite: sql`${daily.cacheWrite} + ${counts.cacheWrite}`,
        totalTokens: sql`${daily.totalTokens} + ${counts.totalTokens}`,
        reasoning: sql`${daily.reasoning} + ${counts.reasoning}`,
        cacheWrite1h: sql`${daily.cacheWrite1h} + ${counts.cacheWrite1h}`,
        reasoningReported: sql`${daily.reasoningReported} + ${counts.reasoningReported}`,
        cacheWrite1hReported: sql`${daily.cacheWrite1hReported} + ${counts.cacheWrite1hReported}`,
        costUsd: sql`${daily.costUsd} + ${counts.costUsd}`,
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
