/** Durable per-invocation usage, independent of Pi transcript commits. @module */
import type { AssistantMessage } from '@earendil-works/pi-ai'
import { parseEnum, parseNullableEnum } from '../../lib/reylo.ts'
import type { LocalDb } from './local.ts'
import acknowledgeUsageQuery from './sql/acknowledge-usage.sql'
import deleteExpiredUsage from './sql/delete-expired-usage.sql'
import finishUsageQuery from './sql/finish-usage.sql'
import insertUsage from './sql/insert-usage.sql'
import interruptUsageQuery from './sql/interrupt-usage.sql'
import selectUnfinishedUsageThrough from './sql/select-unfinished-usage-through.sql'
import selectUsageBySeq from './sql/select-usage-by-seq.sql'
import selectUsageSince from './sql/select-usage-since.sql'
import updateUsageCredential from './sql/update-usage-credential.sql'

const ACTOR_KINDS = ['user', 'agent', 'system'] as const
const CREDENTIAL_KINDS = ['api_key', 'oauth_subscription'] as const
const USAGE_STATUSES = ['in_flight', 'succeeded', 'failed', 'aborted', 'interrupted'] as const
const USAGE_STATES = ['reported', 'partial', 'unknown', 'not_applicable'] as const

/** An invocation's frozen cost owner; never contains message content. */
export interface UsageAttribution {
  chargedAgentId: string
  actorKind: (typeof ACTOR_KINDS)[number]
  jobId?: string | null
}

/** Local usage rows exported in start order. */
export interface UsageRow {
  seq: number
  startedAt: number
  finishedAt: number | null
  chargedAgentId: string
  actorKind: (typeof ACTOR_KINDS)[number]
  jobId: string | null
  credentialId: string | null
  credentialKind: (typeof CREDENTIAL_KINDS)[number] | null
  provider: string
  model: string
  responseModel: string | null
  status: (typeof USAGE_STATUSES)[number]
  rateLimited: boolean
  usageState: (typeof USAGE_STATES)[number]
  input: number | null
  output: number | null
  cacheRead: number | null
  cacheWrite: number | null
  totalTokens: number | null
  reasoning: number | null
  cacheWrite1h: number | null
  inputCost: number | null
  outputCost: number | null
  cacheReadCost: number | null
  cacheWriteCost: number | null
  totalCost: number | null
  aggregatedAt: number | null
}

function parseUsageRow(row: {
  seq: number
  startedAt: number
  finishedAt: number | null
  chargedAgentId: string
  actorKind: string
  jobId: string | null
  credentialId: string | null
  credentialKind: string | null
  provider: string
  model: string
  responseModel: string | null
  status: string
  rateLimited: boolean
  usageState: string
  input: number | null
  output: number | null
  cacheRead: number | null
  cacheWrite: number | null
  totalTokens: number | null
  reasoning: number | null
  cacheWrite1h: number | null
  inputCost: number | null
  outputCost: number | null
  cacheReadCost: number | null
  cacheWriteCost: number | null
  totalCost: number | null
  aggregatedAt: number | null
}): UsageRow {
  return {
    ...row,
    actorKind: parseEnum(ACTOR_KINDS, row.actorKind, 'usage actorKind'),
    credentialKind: parseNullableEnum(CREDENTIAL_KINDS, row.credentialKind, 'usage credentialKind'),
    status: parseEnum(USAGE_STATUSES, row.status, 'usage status'),
    usageState: parseEnum(USAGE_STATES, row.usageState, 'usage state'),
  }
}

/** Persist intent before invoking the lazy provider stream. */
export function startUsage(
  local: LocalDb,
  attribution: UsageAttribution,
  model: { provider: string; id: string },
): number {
  return insertUsage.runSync(local.sql, {
    chargedAgentId: attribution.chargedAgentId,
    actorKind: attribution.actorKind,
    jobId: attribution.jobId ?? null,
    provider: model.provider,
    model: model.id,
    startedAt: Date.now(),
  }).seq
}

/** Attach only the selected credential's public identity, before releasing its secret. */
export function selectUsageCredential(
  local: LocalDb,
  seq: number,
  selection: { credentialId: string; kind: 'api_key' | 'oauth_subscription' },
): void {
  updateUsageCredential.runSync(local.sql, {
    credentialId: selection.credentialId,
    credentialKind: selection.kind,
    seq,
  })
}

/** Terminal delivery is idempotent; absent or ambiguous measurements stay nullable. */
export function finishUsage(local: LocalDb, seq: number, message: AssistantMessage): void {
  const failed = message.stopReason === 'error' || message.stopReason === 'aborted'
  const counts = message.usage
  const observed = counts.input + counts.output + counts.cacheRead + counts.cacheWrite > 0
  const raw = selectUsageBySeq.runSync(local.sql, { seq })
  const row = raw === null ? undefined : parseUsageRow(raw)
  if (!row || row.status !== 'in_flight') return
  finishUsageQuery.runSync(local.sql, {
    seq,
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
    input: observed ? counts.input : null,
    output: observed ? counts.output : null,
    cacheRead: observed ? counts.cacheRead : null,
    cacheWrite: observed ? counts.cacheWrite : null,
    totalTokens: observed ? counts.totalTokens : null,
    reasoning: observed ? (counts.reasoning ?? null) : null,
    cacheWrite1h: observed ? (counts.cacheWrite1h ?? null) : null,
    inputCost: observed ? counts.cost.input : null,
    outputCost: observed ? counts.cost.output : null,
    cacheReadCost: observed ? counts.cost.cacheRead : null,
    cacheWriteCost: observed ? counts.cost.cacheWrite : null,
    totalCost: observed ? counts.cost.total : null,
  })
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
  const candidates = selectUsageSince
    .runSync(local.sql, { after, limit: limit + 1 })
    .map(parseUsageRow)
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
  if (selectUnfinishedUsageThrough.runSync(local.sql, { through }) !== null) {
    throw new Error('Cannot acknowledge unfinished usage')
  }
  acknowledgeUsageQuery.runSync(local.sql, { now, through })
  deleteExpiredUsage.runSync(local.sql, { before: now - 30 * 86_400_000 })
}

/** Only call before opening a new harness epoch, never while old calls can still finish. */
export function interruptUsage(local: LocalDb): void {
  interruptUsageQuery.runSync(local.sql, { finishedAt: Date.now() })
}
