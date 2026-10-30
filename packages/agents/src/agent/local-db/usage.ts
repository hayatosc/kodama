/** Durable per-invocation usage, independent of Pi transcript commits. @module */
import { and, eq, gt, lte, isNull, lt, asc } from 'drizzle-orm'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import { usage } from '../../../drizzle/durable-object/schema.ts'
import type { LocalDb } from './local.ts'

/** An invocation's frozen cost owner; never contains message content. */
export type UsageAttribution = Pick<
  typeof usage.$inferInsert,
  'chargedAgentId' | 'actorKind' | 'jobId'
>

/** Local usage rows exported in start order. */
export type UsageRow = typeof usage.$inferSelect

/** Persist intent before invoking the lazy provider stream. */
export function startUsage(
  local: LocalDb,
  attribution: UsageAttribution,
  model: { provider: string; id: string },
): number {
  return local
    .insert(usage)
    .values({
      ...attribution,
      provider: model.provider,
      model: model.id,
      startedAt: Date.now(),
    })
    .returning({ seq: usage.seq })
    .get().seq
}

/** Attach only the selected credential's public identity, before releasing its secret. */
export function selectUsageCredential(
  local: LocalDb,
  seq: number,
  selection: { credentialId: string; kind: 'api_key' | 'oauth_subscription' },
): void {
  local
    .update(usage)
    .set({
      credentialId: selection.credentialId,
      credentialKind: selection.kind,
    })
    .where(and(eq(usage.seq, seq), eq(usage.status, 'in_flight')))
    .run()
}

/** Terminal delivery is idempotent; absent or ambiguous measurements stay nullable. */
export function finishUsage(local: LocalDb, seq: number, message: AssistantMessage): void {
  const failed = message.stopReason === 'error' || message.stopReason === 'aborted'
  const counts = message.usage
  const observed = counts.input + counts.output + counts.cacheRead + counts.cacheWrite > 0
  const row = local.select().from(usage).where(eq(usage.seq, seq)).get()
  if (!row || row.status !== 'in_flight') return
  local
    .update(usage)
    .set({
      finishedAt: Date.now(),
      status: message.stopReason === 'aborted' ? 'aborted' : failed ? 'failed' : 'succeeded',
      responseModel: message.responseModel ?? null,
      rateLimited: /rate.?limit|429|usage.?limit/i.test(message.errorMessage ?? ''),
      usageState: observed
        ? failed
          ? 'partial'
          : 'reported'
        : failed && row.credentialId === null
          ? 'not_applicable'
          : 'unknown',
      ...(observed
        ? {
            input: counts.input,
            output: counts.output,
            cacheRead: counts.cacheRead,
            cacheWrite: counts.cacheWrite,
            totalTokens: counts.totalTokens,
            reasoning: counts.reasoning ?? null,
            cacheWrite1h: counts.cacheWrite1h ?? null,
            inputCost: counts.cost.input,
            outputCost: counts.cost.output,
            cacheReadCost: counts.cost.cacheRead,
            cacheWriteCost: counts.cost.cacheWrite,
            totalCost: counts.cost.total,
          }
        : {}),
    })
    .where(and(eq(usage.seq, seq), eq(usage.status, 'in_flight')))
    .run()
}

/** A bounded terminal prefix; more includes an unfinished invocation blocking export. */
export interface UsagePage {
  rows: UsageRow[]
  through: number
  more: boolean
}

/** Never skip an older unfinished call when exporting in start order. */
export function usageSince(local: LocalDb, after: number, limit: number): UsagePage {
  if (
    !Number.isSafeInteger(after) ||
    after < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 20
  )
    throw new TypeError('Invalid usage page')
  const candidates = local
    .select()
    .from(usage)
    .where(gt(usage.seq, after))
    .orderBy(asc(usage.seq))
    .limit(limit + 1)
    .all()
  const rows: UsageRow[] = []
  for (const row of candidates) {
    if (row.status === 'in_flight' || rows.length === limit) break
    rows.push(row)
  }
  return { rows, through: rows.at(-1)?.seq ?? after, more: candidates.length > rows.length }
}

/** Prune thirty-day acknowledged details without deleting unaggregated rows. */
export function acknowledgeUsage(local: LocalDb, through: number, now = Date.now()): void {
  if (!Number.isSafeInteger(through) || through < 0)
    throw new TypeError('Invalid usage acknowledgment')
  if (
    local
      .select({ seq: usage.seq })
      .from(usage)
      .where(and(lte(usage.seq, through), eq(usage.status, 'in_flight')))
      .get()
  )
    throw new Error('Cannot acknowledge unfinished usage')
  local
    .update(usage)
    .set({ aggregatedAt: now })
    .where(and(lte(usage.seq, through), isNull(usage.aggregatedAt)))
    .run()
  local
    .delete(usage)
    .where(lt(usage.aggregatedAt, now - 30 * 86_400_000))
    .run()
}

/** Only call before opening a new harness epoch, never while old calls can still finish. */
export function interruptUsage(local: LocalDb): void {
  local
    .update(usage)
    .set({ status: 'interrupted', usageState: 'unknown', finishedAt: Date.now() })
    .where(eq(usage.status, 'in_flight'))
    .run()
}
