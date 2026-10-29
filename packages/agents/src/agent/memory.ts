/**
 * Refresh a working agent's memory, and hand its new conversation entries to the memory agent once
 * it has been idle for a while.
 *
 * @see docs/memory.md — Working agents, Extract
 *
 * @module
 */
import { safeFailure } from '../lib/errors.ts'
import type { Harness } from '@earendil-works/pi-durable'
import { setAlarm, setAlarmNoLaterThan } from './runtime/alarms.ts'
import { appliedSettings } from './runtime/config-apply.ts'
import { isIdle } from './runtime/harness.ts'
import { extractionCheckpoint, memoryDb } from '../memory/store/db.ts'
import {
  refreshAlwaysLoaded,
  refreshAlwaysLoadedIfChanged,
} from '../memory/working/always-loaded.ts'
import { MEMORY_AGENT_NAME } from '../memory/jobs.ts'
import type { WorkingMemoryDeps } from '../memory/working/deps.ts'
import { contactBoundary } from './local-db/external-data.ts'
import { ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import { latestEntryId } from '../memory/transcript.ts'

/** How long an agent stays idle before its new entries are extracted. */
export const EXTRACT_IDLE_DELAY_MS = 10 * 60_000

/** Set by new activity, cleared once its entries are queued for extraction. */
const EXTRACT_PENDING_KEY = 'kodama:extract-pending'

/** Whether the applied version leaves extraction on; it is on until a version turns it off. */
export async function extracts(storage: DurableObjectStorage): Promise<boolean> {
  return (await appliedSettings(storage))?.memoryPolicy.extract !== false
}

/** Refresh the prompt copy; a failed refresh keeps the previous memory without blocking chat. */
export async function refreshMemory(
  memory: WorkingMemoryDeps,
  options: { onlyIfChanged?: boolean } = {},
): Promise<void> {
  try {
    if (options.onlyIfChanged === true) await refreshAlwaysLoadedIfChanged(memory)
    else await refreshAlwaysLoaded(memory)
  } catch (error) {
    console.error('Long-term memory refresh failed', safeFailure(error))
  }
}

/** New activity ends the previous idle period; its completion starts a fresh delay. */
export async function markActivity(storage: DurableObjectStorage): Promise<void> {
  await storage.put(EXTRACT_PENDING_KEY, true)
  await setAlarm(storage, 'extract', undefined)
}

/**
 * Once idle after activity, set the extraction deadline. Only activity starts an idle period, so
 * reopening keeps an existing deadline.
 */
export async function scheduleExtraction(storage: DurableObjectStorage): Promise<void> {
  if (!(await extracts(storage))) return
  if (await storage.get<boolean>(EXTRACT_PENDING_KEY)) {
    await setAlarmNoLaterThan(storage, 'extract', Date.now() + EXTRACT_IDLE_DELAY_MS)
  }
}

/**
 * The extraction alarm: queue the new entries if the agent is still idle, then end the idle period.
 *
 * @remarks
 * The applied version decides at run time: one that disabled extraction after the alarm was set
 * wins, and the alarm is dropped. The pending activity stays for re-enabling.
 */
export async function runExtraction(
  memory: WorkingMemoryDeps,
  harness: Harness,
  storage: DurableObjectStorage,
): Promise<void> {
  if (!(await extracts(storage))) {
    await setAlarm(storage, 'extract', undefined)
    return
  }
  if (!(await isIdle(harness))) return
  await extractNewEntries(memory, harness)
  await storage.delete(EXTRACT_PENDING_KEY)
  await setAlarm(storage, 'extract', undefined)
}

/** Queue extraction for entries newer than the agent's extraction checkpoint. */
async function extractNewEntries(memory: WorkingMemoryDeps, harness: Harness): Promise<void> {
  const agentId = memory.agentId()
  const latest = await latestEntryId(harness)
  const checkpoint = await extractionCheckpoint(memoryDb(memory.env.MEMORY_DB), agentId)
  if (latest === undefined || latest <= checkpoint) return
  await memory.env.AGENTS.getByName(MEMORY_AGENT_NAME).enqueue({
    kind: 'extract',
    sourceAgentId: agentId,
    afterEntry: checkpoint,
    eligibleThrough: contactBoundary(await memory.local(), String(ROOT_CONVERSATION_ID)),
  })
}
