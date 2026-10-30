/**
 * Safety checks before pruning deletes Pi's rows.
 *
 * @see docs/memory.md — Pruning
 *
 * @module
 */
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import type { Harness } from '@earendil-works/pi-durable'
import { hasSingleConversation } from '../../agent/local-db/pruning.ts'
import type { Run } from '../../agent/local-db/pruning.ts'

const context = BACKGROUND_CONTEXT

/**
 * Whether nothing can still read the run's entries: no live task, background compaction included,
 * no queued input, only the root conversation, and a head at or past the run.
 */
export async function safeToDelete(
  storage: DurableObjectStorage,
  harness: Harness,
  run: Run,
): Promise<boolean> {
  const { tasks, submissions } = await harness.inspect(context)
  if (tasks.length > 0 || submissions.length > 0) return false
  if (!hasSingleConversation(storage)) return false
  const marker = await harness.commit((tx) => tx.latestHeadMarker(ROOT_CONVERSATION_ID), context)
  return marker !== undefined && marker.head >= run.head
}
