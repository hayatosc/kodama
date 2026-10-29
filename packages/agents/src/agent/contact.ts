/** Working-agent contact delivery, persisted provenance, and bounded reply observation. @module */
import {
  BACKGROUND_CONTEXT,
  awaitWithContext,
  withAbortSignal,
} from '@earendil-works/chord/context'
import type { Context } from '@earendil-works/chord/context'
import { ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import type { Cursor, EntryRecord, Harness } from '@earendil-works/pi-durable'
import type { AgentEnv } from '../env.ts'
import { managementDb } from '../management/db.ts'
import { resolveAgentRef } from '../management/registry.ts'
import { currentRunInputs } from '../runtime/inputs.ts'
import type {
  AgentOrigin,
  SendMessageRequest,
  SendMessageResponse,
  SubmissionStatus,
} from '../protocol.ts'

/** Legacy provenance cap; permanent contact restrictions additionally forbid forwarding peers. */
export const MAX_CONTACT_HOPS = 3
/** Keep the sender responsive even when the receiver is queued or slow. */
export const CONTACT_WAIT_MS = 30_000

function inputHop(entry: EntryRecord): number {
  if (entry.kind === 'pi.user' || entry.kind === 'kodama.owner-message') return 0
  const data = entry.data
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
                entry.kind === 'kodama.agent-message'
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

/** Resolve and deliver through sendTo, then observe only the answer correlated to that submission. */
export async function contactAgent(
  env: Pick<AgentEnv, 'MANAGEMENT_DB' | 'AGENTS'>,
  sendTo: (agentId: string, request: SendMessageRequest) => Promise<SendMessageResponse>,
  target: string,
  message: string,
  requestId: string,
  context: Context,
): Promise<string> {
  context.abortSignal?.throwIfAborted()
  const row = await resolveAgentRef(managementDb(env.MANAGEMENT_DB), target)
  const accepted = await sendTo(row.agentId, { requestId, content: message })
  const receiver = env.AGENTS.getByName(row.objectName)
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(), CONTACT_WAIT_MS)
  const waiting = withAbortSignal(deadline.signal, context)
  try {
    while (true) {
      using status = await awaitWithContext<(SubmissionStatus & Disposable) | undefined>(
        receiver.submission(requestId),
        waiting,
      )
      if (status?.status === 'unanswered')
        return JSON.stringify({
          ...accepted,
          status: 'unanswered',
          reason: status.reason,
          detail: status.detail,
        })
      if (status?.status === 'done') {
        using snapshot = await awaitWithContext(receiver.snapshot(), waiting)
        const answer = snapshot.messages.find(
          (entry) => entry.entryId === status.answerEntryId && entry.role === 'assistant',
        )
        return JSON.stringify({
          ...accepted,
          status: 'answered',
          answer: answer?.text,
          answerUnavailable: answer === undefined,
        })
      }
      let pause: ReturnType<typeof setTimeout> | undefined
      try {
        await awaitWithContext(
          new Promise<void>((resolve) => {
            pause = setTimeout(resolve, 250)
          }),
          waiting,
        )
      } finally {
        clearTimeout(pause)
      }
    }
  } catch (error) {
    context.abortSignal?.throwIfAborted()
    if (!deadline.signal.aborted) throw error
    return JSON.stringify({
      ...accepted,
      status: 'pending',
      message: 'Accepted; the receiver is still processing. Do not resend the same question.',
    })
  } finally {
    clearTimeout(timer)
  }
}
