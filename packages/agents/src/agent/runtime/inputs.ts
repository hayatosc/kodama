/** Read the durable input set owned by the active root execution, not transcript order. @module */
import { LiveDoc, ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import type { EntryId, EntryRecord, Harness } from '@earendil-works/pi-durable'
import type { Context } from '@earendil-works/chord/context'

/**
 * Resolve every input of the current run, including steering admitted after it started.
 * Undefined means idle; missing active provenance fails closed rather than implying human input.
 * Call outside a commit: submission reads share the harness mutation line.
 */
export async function currentRunInputs(
  harness: Harness,
  context: Context,
): Promise<readonly EntryRecord[] | undefined> {
  const live = await harness.snapshot(LiveDoc, ROOT_CONVERSATION_ID, context)
  if (!live?.run) return undefined
  if (live.run.inputs.length === 0) throw new Error('Execution has no input provenance')
  const ids: EntryId[] = []
  for (const id of live.run.inputs) {
    const submission = await harness.submission(id, context)
    const status = await submission?.status(context)
    if (status?.type !== 'input' || status.entry === undefined)
      throw new Error('Execution input provenance is unavailable')
    ids.push(status.entry)
  }
  return harness.commit(async (tx) => {
    const inputs = []
    for (const id of ids) {
      const entry = await tx.entry(id)
      if (!entry || entry.conversationId !== ROOT_CONVERSATION_ID)
        throw new Error('Execution input entry is unavailable')
      inputs.push(entry)
    }
    return inputs
  }, context)
}
