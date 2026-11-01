/** Persisted peer provenance shared by direct RPC delivery and model-initiated contact. @module */
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { LiveDoc, ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import type { Cursor, EntryRecord, Harness, ToolExecutionApi } from '@earendil-works/pi-durable'
import type { Context } from '@earendil-works/chord/context'
import type { LocalDb } from './local-db/local.ts'
import {
  contactReplay,
  reserveContact,
  pendingContactReceipts,
  updateReceipt,
  acceptContact,
  contactRequest,
  finishContactAcknowledgement,
  retryContact,
  deferContact,
  settleContact,
} from './local-db/contacts.ts'
import { agentRow } from '../control-plane/registry.ts'
import { managementDb } from '../control-plane/db.ts'
import type { AgentEnv } from '../env.ts'
import { submissionOf } from './runtime/views.ts'
import { MAX_CONTACT_RESULT_BYTES } from '../extensions.ts'
import type { ContactResult } from '../extensions.ts'
import { currentRunInputs } from './runtime/inputs.ts'
import type { AgentOrigin } from '../protocol.ts'

/** Bound peer forwarding chains independently of memory or prior external reads. */
export const MAX_CONTACT_HOPS = 3

/** Bound observation of one exclusive attempt; the remote RPC is not assumed cancelled. */
export const CONTACT_ATTEMPT_MS = 30_000

/** Bound the entire contact alarm purpose so later due purposes can make progress. */
export const CONTACT_ALARM_BUDGET_MS = 5_000

/** Bound unresolved RPC lifetimes, including terminal contacts awaiting acknowledgement. */
export const MAX_CONTACT_FLIGHTS = 10

function inputHop(entry: EntryRecord): number {
  if (entry.kind === 'pi.user' || entry.kind === 'kodama.owner-message') return 0
  const data = entry.data
  if (
    entry.kind === 'kodama.scheduled-message' &&
    typeof data === 'object' &&
    data !== null &&
    'hop' in data &&
    data.hop === 0
  )
    return 0
  if (
    entry.kind !== 'kodama.agent-message' ||
    typeof data !== 'object' ||
    data === null ||
    !('hop' in data) ||
    typeof data.hop !== 'number' ||
    !Number.isInteger(data.hop) ||
    data.hop < 1 ||
    data.hop > MAX_CONTACT_HOPS
  )
    throw new Error('Invalid agent message provenance')
  return data.hop
}

/** Derive the maximum incoming hop of the whole execution, never from model-authored text. */
export async function contactOrigin(harness: Harness, senderAgentId: string): Promise<AgentOrigin> {
  const inputs = await currentRunInputs(harness, BACKGROUND_CONTEXT)
  // Idle sendTo RPCs have no executing tool; retain their last durable input provenance.
  const hop =
    inputs === undefined
      ? await harness.commit(async (tx) => {
          let cursor: Cursor | undefined
          do {
            const page = await tx.scanEntries(
              { conversationId: ROOT_CONVERSATION_ID, order: 'descending' },
              64,
              cursor,
            )
            for (const entry of page.items) {
              if (
                entry.kind === 'pi.user' ||
                entry.kind === 'kodama.owner-message' ||
                entry.kind === 'kodama.agent-message' ||
                entry.kind === 'kodama.scheduled-message'
              )
                return inputHop(entry)
            }
            cursor = page.next
          } while (cursor !== undefined)
          return 0
        }, BACKGROUND_CONTEXT)
      : Math.max(...inputs.map(inputHop))
  if (hop >= MAX_CONTACT_HOPS)
    throw new Error(`Agent contact refused: delegation hop limit ${MAX_CONTACT_HOPS} reached`)
  return { senderAgentId, hop: hop + 1 }
}

/** Bind replay identity to the actual adopted tool and its entire durable input set. */
export async function reserveToolContact(
  local: LocalDb,
  harness: Harness,
  senderAgentId: string,
  targetAgentId: string,
  target: string,
  message: string,
  api: Pick<ToolExecutionApi, 'taskId' | 'conversationId'>,
  invocation: Context,
  checkAllowed: () => void,
) {
  invocation.abortSignal?.throwIfAborted()
  if (api.conversationId !== ROOT_CONVERSATION_ID) throw new Error('contact_execution_required')
  const live = await harness.snapshot(LiveDoc, ROOT_CONVERSATION_ID, invocation)
  const inputs = await currentRunInputs(harness, invocation)
  if (!live?.run || !inputs?.length) throw new Error('contact_execution_required')
  const origin = await contactOrigin(harness, senderAgentId)
  const runId = live.run.taskId
  const inputIds = JSON.stringify(live.run.inputs)
  return harness.commit(async (tx) => {
    const current = await tx.doc(LiveDoc, ROOT_CONVERSATION_ID)
    if (
      current.run?.taskId !== runId ||
      JSON.stringify(current.run.inputs) !== inputIds ||
      ![...(current.tools ?? []), ...(current.nestedTools ?? [])].some(
        (tool) => tool.taskId === api.taskId && tool.status === 'running',
      )
    )
      throw new Error('contact_execution_changed')
    invocation.abortSignal?.throwIfAborted()
    checkAllowed()
    const args = JSON.stringify({ target, message })
    return (
      contactReplay(local, String(api.taskId), args) ??
      reserveContact(
        local,
        {
          sourceTask: String(api.taskId),
          sourceEntry: Math.max(...inputs.map((entry) => entry.id)),
          arguments: args,
          targetAgentId,
          content: message,
          hop: origin.hop,
        },
        Date.now(),
      )
    )
  }, invocation)
}

/** Bound by UTF-8 bytes without splitting code points; result text is data, never authority. */
export function boundedContactResult(
  outcome: ContactResult['outcome'],
  text: string,
): ContactResult {
  const bytes = new TextEncoder().encode(text)
  if (bytes.byteLength <= MAX_CONTACT_RESULT_BYTES)
    return { outcome, text, truncated: false, artifactIds: [] }
  let end = MAX_CONTACT_RESULT_BYTES
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--
  return {
    outcome,
    text: new TextDecoder().decode(bytes.subarray(0, end)),
    truncated: true,
    artifactIds: [],
  }
}

/** Persist receiver results before pruning; a missing answer is never a successful empty answer. */
export async function reconcileContactReceipts(local: LocalDb, harness: Harness): Promise<void> {
  for (const receipt of pendingContactReceipts(local)) {
    const status = await submissionOf(harness, receipt.requestId)
    if (!status) continue
    let result: ContactResult | undefined
    if (status.status === 'done') {
      const entry = await harness.commit(async (tx) => {
        const submission = await tx.submissionByRequest(ROOT_CONVERSATION_ID, receipt.requestId)
        return submission?.type === 'input' &&
          submission.status === 'done' &&
          submission.answer !== undefined
          ? tx.entry(submission.answer)
          : undefined
      }, BACKGROUND_CONTEXT)
      if (!entry || entry.kind !== 'pi.assistant' || !entry.model)
        result = boundedContactResult('unanswered', 'answer_unavailable')
      else {
        const text = entry.model
          .filter((message) => message.role === 'assistant')
          .map((message) =>
            typeof message.content === 'string'
              ? message.content
              : message.content
                  .filter((part) => part.type === 'text')
                  .map((part) => part.text)
                  .join('\n'),
          )
          .join('\n')
        result = boundedContactResult('succeeded', text)
      }
    } else if (status.status === 'unanswered') {
      result = boundedContactResult(
        status.reason.includes('abort') ? 'cancelled' : 'unanswered',
        `unanswered:${status.reason}`,
      )
    }
    updateReceipt(local, receipt, status.id, result)
  }
}

/** Retry durable delivery and pull only the validated receipt, never a transient transcript snapshot. */
export async function collectContact(
  local: LocalDb,
  env: Pick<AgentEnv, 'AGENTS' | 'MANAGEMENT_DB'>,
  senderAgentId: string,
  id: string,
): Promise<void> {
  let row = contactRequest(local, id)
  if (!row || (row.settledAt !== null && row.retryAt === 0)) return
  try {
    const target = await agentRow(managementDb(env.MANAGEMENT_DB), row.targetAgentId)
    if (target.kind !== 'working') throw new Error('contact_target_invalid')
    const peer = env.AGENTS.getByName(target.objectName)
    if (row.state === 'dispatching') {
      const submissionId = await peer.acceptTrackedContact(senderAgentId, id)
      if (submissionId !== undefined) acceptContact(local, id, submissionId, Date.now())
    }
    using receipt = await peer.trackedContactResult(senderAgentId, id)
    if (receipt?.result) settleContact(local, id, receipt.result, Date.now())
    row = contactRequest(local, id)
    if (row && row.settledAt !== null) {
      // A hung ack must not leave a past-due result spinning the purpose scheduler.
      deferContact(local, id, Date.now())
      await peer.acknowledgeTrackedContact(senderAgentId, id)
      finishContactAcknowledgement(local, id)
    } else deferContact(local, id, Date.now())
  } catch (error) {
    retryContact(local, id, Date.now())
    throw error
  }
}
