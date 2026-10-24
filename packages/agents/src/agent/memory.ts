/**
 * Refresh a working agent's memory and hand new conversation entries to the memory agent.
 *
 * @see docs/memory.md — Working agents, Extract
 *
 * @module
 */
import type { Harness } from '@earendil-works/pi-durable'
import { extractionCheckpoint, memoryDb } from '../memory/store/db.ts'
import {
  refreshAlwaysLoaded,
  refreshAlwaysLoadedIfChanged,
} from '../memory/working/always-loaded.ts'
import { MEMORY_AGENT_NAME } from '../memory/jobs.ts'
import type { WorkingMemoryDeps } from '../memory/working/deps.ts'
import { latestEntryId } from '../memory/transcript.ts'

/** How long an agent stays idle before its new entries are extracted. */
export const EXTRACT_IDLE_DELAY_MS = 10 * 60_000

/** Refresh the prompt copy; a failed refresh keeps the previous memory without blocking chat. */
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

/** Queue extraction for entries newer than the agent's extraction checkpoint. */
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
