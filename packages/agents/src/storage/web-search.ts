/** Usage-owned anonymous attempt history, derived cooldowns, and private root-session reuse. @module */
import { and, desc, eq, gte, isNotNull, isNull, or } from 'drizzle-orm'
import { usage } from '../../drizzle/durable-object/schema.ts'
import type { LocalDb } from './local.ts'
import type { KeylessProvider } from '../tools/web/keyless-results.ts'
import type { KeylessAttempt, ProviderState } from '../tools/web/keyless-search.ts'

/** Derive limits from the newest authoritative attempt, without a second provider ledger. */
export function searchProviderState(
  local: LocalDb,
  provider: KeylessProvider,
): ProviderState | undefined {
  for (const row of searchHistory(local)) {
    const attempt = row.searchAttempts.findLast(
      (attempt) => attempt.provider === provider && attempt.consecutive429 !== null,
    )
    if (attempt)
      return { blockedUntil: attempt.cooldown ?? 0, consecutive429: attempt.consecutive429 ?? 0 }
  }
  return undefined
}

function searchHistory(local: LocalDb) {
  return local
    .select({
      seq: usage.seq,
      searchAttempts: usage.searchAttempts,
      searchSessionId: usage.searchSessionId,
    })
    .from(usage)
    .where(eq(usage.keyless, true))
    .orderBy(desc(usage.seq))
    .all()
}

/** Count failed and interrupted sends, then append the pending send to its owning invocation. */
export function startSearchAttempt(
  local: LocalDb,
  usageSeq: number,
  provider: KeylessProvider,
  now = Date.now(),
): void {
  const recent = local
    .select({ attempts: usage.searchAttempts })
    .from(usage)
    .where(
      and(
        eq(usage.keyless, true),
        or(gte(usage.finishedAt, now - 60_000), isNull(usage.finishedAt)),
      ),
    )
    .all()
  const count = recent.reduce(
    (sum, row) => sum + row.attempts.filter((attempt) => attempt.startedAt >= now - 60_000).length,
    0,
  )
  if (count >= 10) throw new Error('rate_limited')
  const row = local
    .select()
    .from(usage)
    .where(and(eq(usage.seq, usageSeq), eq(usage.status, 'in_flight')))
    .get()
  if (!row) throw new Error('interrupted')
  local
    .update(usage)
    .set({
      provider,
      searchAttempts: [
        ...row.searchAttempts,
        {
          provider,
          startedAt: now,
          finishedAt: null,
          status: null,
          reason: null,
          cooldown: null,
          consecutive429: null,
          bytes: null,
        },
      ],
    })
    .where(eq(usage.seq, usageSeq))
    .run()
}

/** Complete the pending send before rotating; the 429 streak is a minimal retention checkpoint. */
export function finishSearchAttempt(
  local: LocalDb,
  usageSeq: number,
  attempt: KeylessAttempt,
  next: ProviderState | undefined,
): void {
  const row = local
    .select()
    .from(usage)
    .where(and(eq(usage.seq, usageSeq), eq(usage.status, 'in_flight')))
    .get()
  if (!row) return
  const index = row.searchAttempts.findLastIndex(
    (stored) => stored.provider === attempt.provider && stored.finishedAt === null,
  )
  if (index < 0) return
  const attempts = row.searchAttempts.map((stored, position) =>
    position === index
      ? {
          ...attempt,
          startedAt: stored.startedAt,
          consecutive429: next?.consecutive429 ?? null,
        }
      : stored,
  )
  local.update(usage).set({ searchAttempts: attempts }).where(eq(usage.seq, usageSeq)).run()
}

/** Parallel's last successful session belongs to its usage row, never to the terminal audit. */
export function saveSearchSession(local: LocalDb, usageSeq: number, sessionId: string): void {
  local.update(usage).set({ searchSessionId: sessionId }).where(eq(usage.seq, usageSeq)).run()
}

/** Reuse only this root object's latest successful Parallel session. */
export function searchSession(local: LocalDb): string | undefined {
  return (
    local
      .select({ session: usage.searchSessionId })
      .from(usage)
      .where(isNotNull(usage.searchSessionId))
      .orderBy(desc(usage.seq))
      .get()?.session ?? undefined
  )
}

/** Safe ordered attempt metadata for recovery and the terminal audit pipeline. */
export function searchAttempts(local: LocalDb, usageSeq: number) {
  return (
    local
      .select({ attempts: usage.searchAttempts })
      .from(usage)
      .where(eq(usage.seq, usageSeq))
      .get()?.attempts ?? []
  )
}

/** Retain active cooldowns plus the latest streak/session checkpoints beyond ordinary usage retention. */
export function retainedSearchUsage(local: LocalDb, now: number): Set<number> {
  const retained = new Set<number>()
  const providers = new Set<string>()
  let session = false
  for (const row of searchHistory(local)) {
    if (!session && row.searchSessionId !== null) {
      retained.add(row.seq)
      session = true
    }
    for (const attempt of row.searchAttempts.toReversed()) {
      if (attempt.cooldown !== null && attempt.cooldown > now) retained.add(row.seq)
      if (attempt.consecutive429 !== null && !providers.has(attempt.provider)) {
        providers.add(attempt.provider)
        retained.add(row.seq)
      }
    }
  }
  return retained
}
