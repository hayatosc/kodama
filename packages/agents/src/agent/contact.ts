/** Persisted peer provenance shared by direct RPC delivery and model-initiated contact. @module */
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import type { Cursor, EntryRecord, Harness } from '@earendil-works/pi-durable'
import { currentRunInputs } from '../runtime/inputs.ts'
import type { AgentOrigin } from '../protocol.ts'

/** Legacy provenance cap; permanent contact restrictions additionally forbid forwarding peers. */
export const MAX_CONTACT_HOPS = 3

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
