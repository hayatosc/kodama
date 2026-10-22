/** Long-term memory as one working agent object uses it (Working agents, Extract). */
import type { Harness } from '@earendil-works/pi-durable'
import { extractionCheckpoint, memoryDb } from '../memory/store/db.ts'
import {
  refreshAlwaysLoaded,
  refreshAlwaysLoadedIfChanged,
} from '../memory/working/always-loaded.ts'
import { MEMORY_AGENT_NAME } from '../memory/jobs.ts'
import type { WorkingMemoryDeps } from '../memory/working/deps.ts'
import { latestEntryId } from './entries.ts'

/** An agent idle this long gets its new entries extracted into long-term memory. */
export const EXTRACT_IDLE_DELAY_MS = 10 * 60_000

/**
 * Render the always-loaded copy again, or only if a scope revision changed. Memory is an aid to
 * the conversation, not a condition for it: a failure is logged and keeps the previous copy.
 */
export async function refreshMemory(
  memory: WorkingMemoryDeps,
  options: { onlyIfChanged?: boolean } = {},
): Promise<void> {
  try {
    if (options.onlyIfChanged === true) await refreshAlwaysLoadedIfChanged(memory)
    else await refreshAlwaysLoaded(memory)
  } catch (error) {
    console.error('Long-term memory refresh failed', error)
  }
}

/** Hand the entries extraction has not covered to the memory agent. */
export async function extractNewEntries(
  memory: WorkingMemoryDeps,
  harness: Harness,
): Promise<void> {
  const agentId = memory.agentId()
  const latest = await latestEntryId(harness)
  const checkpoint = await extractionCheckpoint(memoryDb(memory.env.MEMORY_DB), agentId)
  if (latest === undefined || latest <= checkpoint) return
  await memory.env.AGENTS.getByName(MEMORY_AGENT_NAME).enqueue({
    kind: 'extract',
    sourceAgentId: agentId,
    afterEntry: checkpoint,
  })
}
