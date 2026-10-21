import type { AgentEventStream, SubmissionRecord } from '@earendil-works/pi-durable'
import type { AgentMessage, AgentSnapshot, SubmissionStatus } from '../protocol.ts'

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

export function toSubmissionStatus(
  requestId: string,
  submission: SubmissionRecord,
): SubmissionStatus {
  const { id } = submission
  if (submission.status !== 'unanswered') return { id, requestId, status: submission.status }
  const { status, reason, detail } = submission
  if (detail === undefined) return { id, requestId, status, reason }
  const text = typeof detail === 'string' ? detail : JSON.stringify(detail)
  return { id, requestId, status, reason, detail: text }
}
