/**
 * Read-only views of an agent's session for RPC: Pi's state mapped to snapshots and submission statuses.
 *
 * @module
 */
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { ROOT_CONVERSATION_ID, watchEvents } from '@earendil-works/pi-durable'
import type { Harness, AgentEventStream, SubmissionRecord } from '@earendil-works/pi-durable'
import type {
  AgentSnapshot,
  SubmissionStatus,
  AgentMessage,
  AttentionItem,
} from '../../protocol.ts'
import type { LocalDb } from '../local-db/local.ts'
import { pendingContacts } from '../local-db/contacts.ts'

const context = BACKGROUND_CONTEXT

/** The agent's committed messages and whether it is busy. */
export async function snapshotOf(harness: Harness): Promise<AgentSnapshot> {
  const stream = await watchEvents(harness, ROOT_CONVERSATION_ID, context)
  try {
    return toAgentSnapshot(stream.snapshot)
  } finally {
    await stream.stop()
  }
}

/** The status of the root conversation's submission with this request ID, if there is one. */
export async function submissionOf(
  harness: Harness,
  requestId: string,
): Promise<SubmissionStatus | undefined> {
  const submission = await harness.commit(
    (tx) => tx.submissionByRequest(ROOT_CONVERSATION_ID, requestId),
    context,
  )
  return submission === undefined ? undefined : toSubmissionStatus(requestId, submission)
}

/** Project execution/contact waits; unknown progress timestamps remain null. */
export async function attentionOf(harness: Harness, db: LocalDb): Promise<AttentionItem[]> {
  const watch = await watchEvents(harness, ROOT_CONVERSATION_ID, context)
  try {
    const view = watch.snapshot
    const items: AttentionItem[] = []
    if (view.run || view.inbox.length > 0) {
      const timestamps = view.entries.flatMap((entry) =>
        (entry.model ?? []).map((message) => message.timestamp),
      )
      const partialAt = view.generation?.message?.timestamp
      if (partialAt !== undefined) timestamps.push(partialAt)
      items.push({
        source: 'execution',
        id: String(ROOT_CONVERSATION_ID),
        reason: view.generation?.retry
          ? 'model_retry_wait'
          : view.generation?.deferred
            ? 'model_deferred_wait'
            : view.tools.length > 0
              ? 'tool_execution'
              : view.run
                ? 'model_execution'
                : 'queued_input',
        lastProgressAt: timestamps.length ? Math.max(...timestamps) : null,
        actions: ['cancel'],
      })
    }
    for (const row of pendingContacts(db)) {
      items.push({
        source: 'contact',
        id: row.id,
        reason: row.state === 'dispatching' ? 'contact_delivery_wait' : 'contact_result_wait',
        lastProgressAt: row.createdAt,
        actions: [],
      })
    }
    return items
  } finally {
    await watch.stop()
  }
}

type PiSnapshot = AgentEventStream['snapshot']
type PiModelMessage = NonNullable<PiSnapshot['entries'][number]['model']>[number]

function messageText(content: Extract<PiModelMessage, { role: 'user' | 'assistant' }>['content']) {
  if (typeof content === 'string') return content
  return content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
}

/** Reduce Pi's session snapshot to the user-visible transcript. */
export function toAgentSnapshot(snapshot: PiSnapshot): AgentSnapshot {
  const messages: AgentMessage[] = []
  for (const entry of snapshot.entries) {
    for (const message of entry.model ?? []) {
      if (message.role !== 'user' && message.role !== 'assistant') continue
      messages.push({ entryId: entry.id, role: message.role, text: messageText(message.content) })
    }
  }
  return { messages, busy: snapshot.run !== undefined || snapshot.inbox.length > 0 }
}

/** Map Pi's submission record to the RPC status, with a non-string detail JSON-encoded. */
export function toSubmissionStatus(
  requestId: string,
  submission: SubmissionRecord,
): SubmissionStatus {
  const { id } = submission
  if (submission.status === 'done' && submission.type === 'input')
    return { id, requestId, status: 'done', answerEntryId: submission.answer }
  if (submission.status !== 'unanswered') return { id, requestId, status: submission.status }
  const { status, reason, detail } = submission
  if (detail === undefined) return { id, requestId, status, reason }
  const text = typeof detail === 'string' ? detail : JSON.stringify(detail)
  return { id, requestId, status, reason, detail: text }
}
