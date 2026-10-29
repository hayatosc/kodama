/** Durable anonymous cooldowns, actual-send caps, and root-session reuse. @module */
import { and, eq, gte, isNull } from 'drizzle-orm'
import { webSearchAttempts, webSearchProviderState } from '../../drizzle/durable-object/schema.ts'
import type { LocalDb } from './local.ts'
import type { KeylessProvider } from '../web/keyless-results.ts'
import type { KeylessAttempt, ProviderState } from '../web/keyless-search.ts'

/** Read without resetting an anonymous server's limits after eviction. */
export function searchProviderState(local: LocalDb, provider: KeylessProvider) {
  return local
    .select()
    .from(webSearchProviderState)
    .where(eq(webSearchProviderState.provider, provider))
    .get()
}

/** Count failures and interrupted sends toward the same rolling actual-attempt cap. */
export function startSearchAttempt(
  local: LocalDb,
  usageSeq: number,
  provider: KeylessProvider,
  now = Date.now(),
): void {
  const attempts = local
    .select()
    .from(webSearchAttempts)
    .where(gte(webSearchAttempts.startedAt, now - 60_000))
    .all()
  if (attempts.length >= 10) throw new Error('rate_limited')
  local.insert(webSearchAttempts).values({ usageSeq, provider, startedAt: now }).run()
}

/** Persist cooldown before rotating; only success resets a 429 streak. */
export function finishSearchAttempt(
  local: LocalDb,
  usageSeq: number,
  attempt: KeylessAttempt,
  next: ProviderState | undefined,
): void {
  local.transaction((tx) => {
    tx.update(webSearchAttempts)
      .set(attempt)
      .where(
        and(
          eq(webSearchAttempts.usageSeq, usageSeq),
          eq(webSearchAttempts.provider, attempt.provider),
          isNull(webSearchAttempts.finishedAt),
        ),
      )
      .run()
    if (next)
      tx.insert(webSearchProviderState)
        .values({
          provider: attempt.provider,
          ...next,
          reason: attempt.reason,
          updatedAt: attempt.finishedAt,
        })
        .onConflictDoUpdate({
          target: webSearchProviderState.provider,
          set: { ...next, reason: attempt.reason, updatedAt: attempt.finishedAt },
        })
        .run()
  })
}

/** Parallel's session is private coordination metadata, never an audit field. */
export function saveSearchSession(local: LocalDb, sessionId: string): void {
  local
    .update(webSearchProviderState)
    .set({ sessionId })
    .where(eq(webSearchProviderState.provider, 'parallel'))
    .run()
}

/** Safe attempt metadata for the existing terminal audit pipeline. */
export function searchAttempts(local: LocalDb, usageSeq: number) {
  return local
    .select()
    .from(webSearchAttempts)
    .where(eq(webSearchAttempts.usageSeq, usageSeq))
    .all()
}
