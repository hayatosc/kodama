/**
 * Durable contact outbox, receiver receipts, and atomic sender completion.
 *
 * @see docs/extensions.md — Completion and notification atomicity
 * @module
 */
import * as v from 'valibot'
import { EXTENSION_RETENTION_MS } from '../../extensions.ts'
import type { ContactResult } from '../../extensions.ts'
import { parseEnum, parseJsonValue } from '../../lib/reylo.ts'
import { uuidv7 } from '../../lib/uuid.ts'
import type { LocalDb } from './local.ts'
import { insertNotificationRow } from './notifications.repository.ts'
import { queries } from './queries/index.ts'

const CONTACT_STATES = ['dispatching', 'submitted', 'settled', 'failed'] as const

const contactResultSchema = v.object({
  outcome: v.picklist(['succeeded', 'failed', 'cancelled', 'unanswered']),
  text: v.string(),
  truncated: v.boolean(),
  artifactIds: v.array(v.string()),
})

/** Immutable sender identity and recoverable delivery progress. */
export interface ContactRequest {
  id: string
  sourceTask: string
  sourceEntry: number
  arguments: string
  targetAgentId: string
  requestId: string
  content: string
  hop: number
  state: (typeof CONTACT_STATES)[number]
  submissionId: number | null
  retryAt: number
  attempts: number
  result: ContactResult | null
  createdAt: number
  settledAt: number | null
  expiresAt: number | null
}

/** A receiver admission fence; submissionId zero means acceptance must be recovered from Pi. */
export interface ContactReceipt {
  senderAgentId: string
  requestId: string
  submissionId: number
  result: ContactResult | null
  createdAt: number
  settledAt: number | null
  acknowledgedAt: number | null
  expiresAt: number | null
}

function parseContactResult(raw: string | null): ContactResult | null {
  return raw === null ? null : v.parse(contactResultSchema, parseJsonValue(raw))
}

function parseContactRequest(row: {
  id: string
  sourceTask: string
  sourceEntry: number
  arguments: string
  targetAgentId: string
  requestId: string
  content: string
  hop: number
  state: string
  submissionId: number | null
  retryAt: number
  attempts: number
  resultJson: string | null
  createdAt: number
  settledAt: number | null
  expiresAt: number | null
}): ContactRequest {
  return {
    id: row.id,
    sourceTask: row.sourceTask,
    sourceEntry: row.sourceEntry,
    arguments: row.arguments,
    targetAgentId: row.targetAgentId,
    requestId: row.requestId,
    content: row.content,
    hop: row.hop,
    state: parseEnum(CONTACT_STATES, row.state, 'contact request state'),
    submissionId: row.submissionId,
    retryAt: row.retryAt,
    attempts: row.attempts,
    result: parseContactResult(row.resultJson),
    createdAt: row.createdAt,
    settledAt: row.settledAt,
    expiresAt: row.expiresAt,
  }
}

function parseContactReceipt(row: {
  senderAgentId: string
  requestId: string
  submissionId: number
  resultJson: string | null
  createdAt: number
  settledAt: number | null
  acknowledgedAt: number | null
  expiresAt: number | null
}): ContactReceipt {
  return {
    senderAgentId: row.senderAgentId,
    requestId: row.requestId,
    submissionId: row.submissionId,
    result: parseContactResult(row.resultJson),
    createdAt: row.createdAt,
    settledAt: row.settledAt,
    acknowledgedAt: row.acknowledgedAt,
    expiresAt: row.expiresAt,
  }
}

/** Find the sender's immutable record, including expired replay tombstones. */
export function contactRequest(db: LocalDb, id: string): ContactRequest | undefined {
  const row = queries.getContactRequestById.runSync(db.sql, { id })
  return row === null ? undefined : parseContactRequest(row)
}

/** Replay requires identical arguments, not merely the same tool task or RPC request ID. */
export function contactReplay(
  db: LocalDb,
  sourceTask: string,
  args: string,
): ContactRequest | undefined {
  const row = queries.getContactRequestBySourceTask.runSync(db.sql, { sourceTask })
  if (row === null) return undefined
  const parsed = parseContactRequest(row)
  if (parsed.arguments !== args) throw new TypeError('contact_replay_mismatch')
  return parsed
}

/** Reserve before dispatch; the source identity comes from a validated execution or private RPC. */
export function reserveContact(
  db: LocalDb,
  input: Pick<
    ContactRequest,
    'sourceTask' | 'sourceEntry' | 'arguments' | 'targetAgentId' | 'content' | 'hop'
  >,
  now: number,
): ContactRequest {
  const open = queries.getPendingContactsCount.runSync(db.sql).value
  if (open >= 100) throw new Error('contact_quota: maximum 100 pending contacts')
  const id = uuidv7()
  return parseContactRequest(
    queries.insertContactRequest.runSync(db.sql, {
      ...input,
      id,
      requestId: `peer-${id}`,
      retryAt: now,
      createdAt: now,
    }),
  )
}

/** Pending delivery and result waits, excluding terminal acknowledgement retries before limiting. */
export function pendingContacts(db: LocalDb): ContactRequest[] {
  return queries.listPendingContacts.runSync(db.sql).map(parseContactRequest)
}

/** Pending dispatches plus terminal results whose receiver acknowledgement still needs retry. */
export function actionableContacts(db: LocalDb, now?: number): ContactRequest[] {
  return queries.listActionableContacts
    .runSync(db.sql, { now: now === undefined ? null : now })
    .map(parseContactRequest)
}

/** Record acceptance without confusing it with successful completion. */
export function acceptContact(db: LocalDb, id: string, submissionId: number, now: number): void {
  queries.updateAcceptContact.runSync(db.sql, { id, submissionId, retryAt: now + 60_000 })
}

/** Defer pending delivery or an outstanding ack without treating observation as a failed RPC. */
export function deferContact(db: LocalDb, id: string, now: number): void {
  const row = contactRequest(db, id)
  if (!row) return
  queries.updateDeferContact.runSync(db.sql, { id, retryAt: Math.max(row.retryAt, now + 60_000) })
}

/** Back off without discarding an ambiguous admission or an unacknowledged result. */
export function retryContact(db: LocalDb, id: string, now: number): void {
  const row = contactRequest(db, id)
  if (!row || (row.settledAt !== null && row.retryAt === 0)) return
  queries.updateRetryContact.runSync(db.sql, {
    id,
    attempts: row.attempts + 1,
    retryAt: now + Math.min(3_600_000, 60_000 * 2 ** Math.min(row.attempts, 6)),
  })
}

/** The first terminal transition and notification are one transaction; replay cannot recreate it. */
export function settleContact(
  db: LocalDb,
  id: string,
  result: ContactResult,
  now: number,
  needsAck = true,
): void {
  db.transactionSync(() => {
    const row = queries.getContactRequestById.runSync(db.sql, { id })
    if (row === null || row.settledAt !== null) return
    queries.updateSettleContact.runSync(db.sql, {
      id,
      state: result.outcome === 'failed' ? 'failed' : 'settled',
      resultJson: JSON.stringify(result),
      settledAt: now,
      expiresAt: now + EXTENSION_RETENTION_MS,
      retryAt: needsAck ? now : 0,
    })
    insertNotificationRow(
      db,
      {
        source: 'contact',
        sourceId: id,
        outcome: result.outcome,
        summary: `Contact ${id} to agent ${row.targetAgentId}: ${result.outcome}.`,
        artifactIds: result.artifactIds,
      },
      now,
    )
  })
}

/** Stop acknowledgement retries only after the receiver durably confirms them. */
export function finishContactAcknowledgement(db: LocalDb, id: string): void {
  queries.updateFinishContactAck.runSync(db.sql, { id })
}

/** Receiver lookup is always scoped by the validated sender and stable request identity. */
export function contactReceipt(
  db: LocalDb,
  senderAgentId: string,
  requestId: string,
): ContactReceipt | undefined {
  const row = queries.getContactReceipt.runSync(db.sql, { senderAgentId, requestId })
  return row === null ? undefined : parseContactReceipt(row)
}

/** Fence pruning before Pi admission, including the stop between admission and saving its ID. */
export function reserveReceipt(
  db: LocalDb,
  senderAgentId: string,
  requestId: string,
  now: number,
): ContactReceipt {
  queries.insertContactReceipt.runSync(db.sql, { senderAgentId, requestId, createdAt: now })
  const row = contactReceipt(db, senderAgentId, requestId)
  if (!row) throw new Error('contact_receipt_missing')
  return row
}

/** Receipts not yet terminal must be reconciled before any Pi history deletion. */
export function pendingContactReceipts(db: LocalDb): ContactReceipt[] {
  return queries.listPendingContactReceipts.runSync(db.sql).map(parseContactReceipt)
}

/** Save the accepted Pi identity or its terminal answer before pruning can remove either. */
export function updateReceipt(
  db: LocalDb,
  receipt: ContactReceipt,
  submissionId: number,
  result?: ContactResult,
  now = Date.now(),
): void {
  if (result) {
    queries.updateSettleContactReceipt.runSync(db.sql, {
      submissionId,
      resultJson: JSON.stringify(result),
      settledAt: now,
      senderAgentId: receipt.senderAgentId,
      requestId: receipt.requestId,
    })
    return
  }
  queries.updateContactReceiptSubmission.runSync(db.sql, {
    submissionId,
    senderAgentId: receipt.senderAgentId,
    requestId: receipt.requestId,
  })
}

/** Receiver retention begins only after the sender's atomic completion has been verified. */
export function acknowledgeReceipt(db: LocalDb, receipt: ContactReceipt, now: number): void {
  queries.updateAcknowledgeContactReceipt.runSync(db.sql, {
    acknowledgedAt: now,
    expiresAt: now + EXTENSION_RETENTION_MS,
    senderAgentId: receipt.senderAgentId,
    requestId: receipt.requestId,
  })
}

/** Clear answer payloads, never replay evidence; pending and unacknowledged receipts do not expire. */
export function retainContacts(db: LocalDb, now: number): void {
  queries.updateExpireContactRequests.runSync(db.sql, { now })
  queries.updateExpireContactReceipts.runSync(db.sql, { now })
}

/** Schedule pending work, ack retries, and answer expiry through the existing purpose scheduler. */
export function nextContactWake(db: LocalDb): number | undefined {
  const now = Date.now()
  const work = actionableContacts(db)[0]?.retryAt
  const senderExpiry = queries.getNextSenderContactExpiry.runSync(db.sql, { now })?.at
  const receiverExpiry = queries.getNextReceiverContactExpiry.runSync(db.sql, { now })?.at
  const times = [work, senderExpiry, receiverExpiry].filter(
    (at): at is number => at !== null && at !== undefined,
  )
  return times.length ? Math.min(...times) : undefined
}

/** Stable local pagination does not leak peer settings, dispatch text, or source provenance. */
export function listContacts(db: LocalDb, cursor?: string, limit = 50) {
  const rows = queries.listContactRequests
    .runSync(db.sql, { cursor: cursor ?? null, limit: limit + 1 })
    .map(parseContactRequest)
  return {
    contacts: rows.slice(0, limit).map((row) => contactView(row, false)),
    nextCursor: rows.length > limit ? rows[limit - 1]?.id : undefined,
  }
}

/** Public local result view reports pending, terminal outcome, and expired payloads explicitly. */
export function contactView(row: ContactRequest, includeResult: boolean, now = Date.now()) {
  const expired = row.expiresAt !== null && row.expiresAt <= now
  return {
    contactId: row.id,
    agentId: row.targetAgentId,
    requestId: row.requestId,
    submissionId: row.submissionId,
    status:
      row.settledAt === null
        ? 'pending'
        : row.result?.outcome === 'succeeded'
          ? 'answered'
          : (row.result?.outcome ?? 'expired'),
    state: row.state,
    createdAt: row.createdAt,
    settledAt: row.settledAt,
    expiresAt: row.expiresAt,
    expired,
    ...(includeResult && !expired && row.result
      ? {
          result: row.result,
          answer: row.result.outcome === 'succeeded' ? row.result.text : undefined,
          truncated: row.result.truncated,
        }
      : {}),
  }
}
