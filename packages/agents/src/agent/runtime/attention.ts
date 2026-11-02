/** Read-only attention projection over Pi, peer outbox, and UI delivery receipts.
 * @module
 */
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { ROOT_CONVERSATION_ID, watchEvents } from '@earendil-works/pi-durable'
import type { Harness } from '@earendil-works/pi-durable'
import type { AttentionItem } from '../../owner-intake.ts'
import type { LocalDb } from '../local-db/local.ts'
import { actionableContacts } from '../local-db/contacts.ts'
import { ownerDeliveryPage } from '../local-db/owner-intake.ts'

/** Unknown timestamps stay null; retry deadlines and error messages are not inferred or exposed. */
export async function attentionOf(harness: Harness, db: LocalDb): Promise<AttentionItem[]> {
  const watch = await watchEvents(harness, ROOT_CONVERSATION_ID, BACKGROUND_CONTEXT)
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
    for (const row of actionableContacts(db)) {
      if (row.state !== 'dispatching' && row.state !== 'submitted') continue
      items.push({
        source: 'contact',
        id: row.id,
        reason: row.state === 'dispatching' ? 'contact_delivery_wait' : 'contact_result_wait',
        lastProgressAt: row.createdAt,
        actions: [],
      })
    }
    for (const row of ownerDeliveryPage(db)) {
      if (row.state === 'accepted') continue
      items.push({
        source: 'delivery',
        id: row.id,
        reason: `delivery_${row.state}`,
        lastProgressAt: row.updatedAt,
        actions: [],
      })
    }
    return items
  } finally {
    await watch.stop()
  }
}
