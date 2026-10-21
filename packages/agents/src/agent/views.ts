/** Read-only views of an agent's session for RPC: its snapshot and a submission's status. */
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { ROOT_CONVERSATION_ID, watchEvents } from '@earendil-works/pi-durable'
import type { Harness } from '@earendil-works/pi-durable'
import { toAgentSnapshot, toSubmissionStatus } from '../projection.ts'
import type { AgentSnapshot, SubmissionStatus } from '../protocol.ts'

const context = BACKGROUND_CONTEXT

export async function snapshotOf(harness: Harness): Promise<AgentSnapshot> {
  const stream = await watchEvents(harness, ROOT_CONVERSATION_ID, context)
  try {
    return toAgentSnapshot(stream.snapshot)
  } finally {
    await stream.stop()
  }
}

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
