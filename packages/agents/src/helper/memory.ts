/**
 * Helpers of the long-term memory tests: the memory database, records, and the memory agent.
 *
 * @module
 */
import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { and, eq } from 'drizzle-orm'
import { MEMORY_AGENT_NAME } from '../memory/jobs.ts'
import { memoryDb } from '../memory/store/db.ts'
import { applyOperation } from '../memory/store/records.ts'
import type { NewRecord } from '../memory/store/records.ts'
import { memoryRecords } from '../../drizzle/d1/schema.ts'
import type { OperationContext } from '../memory/store/statements.ts'
import { refreshAlwaysLoaded, storedMemoryText } from '../memory/working/always-loaded.ts'
import { alwaysLoaded } from '../../drizzle/durable-object/schema.ts'
import { openLocalDb } from '../storage/local.ts'

/** The memory database of the tests. */
export const db = memoryDb(env.MEMORY_DB)
/** The memory agent's stub. */
export const memoryAgent = () => env.MEMORY_AGENT.getByName(MEMORY_AGENT_NAME)

/** A fresh operation, as if from its own job. */
export function context(now = Date.now()): OperationContext {
  const opId = crypto.randomUUID()
  return { opId, jobId: opId, runId: opId, actor: 'test', now }
}

/** Write a record directly, as the memory agent would; returns its ID. */
export async function write(record: Omit<NewRecord, 'origin' | 'observedAt'>): Promise<string> {
  const result = await applyOperation(db, context(), {
    type: 'write',
    record: { origin: 'agent_judgment', observedAt: Date.now(), ...record },
  })
  if (result.status !== 'applied') throw new Error(`write ${result.status}`)
  return result.recordId
}

/** A record by ID, in any status. */
export function record(id: string) {
  return db.select().from(memoryRecords).where(eq(memoryRecords.id, id)).get()
}

/** The contents of an agent's active records. */
export async function activeContents(agentId: string): Promise<string[]> {
  const rows = await db
    .select({ content: memoryRecords.content })
    .from(memoryRecords)
    .where(and(eq(memoryRecords.scope, `agent:${agentId}`), eq(memoryRecords.status, 'active')))
  return rows.map((row) => row.content)
}

/** The always-loaded text an agent object has stored. */
export function storedAlwaysLoaded(agentId: string): Promise<string> {
  return runInDurableObject(env.AGENTS.getByName(agentId), async (_instance, state) => {
    const local = await openLocalDb(state.storage)
    return local.select().from(alwaysLoaded).where(eq(alwaysLoaded.id, 1)).get()?.text ?? ''
  })
}

/** The always-loaded text rendered now for an agent that reads `spaces`. */
export function renderedAlwaysLoaded(agentId: string, spaces: string[]): Promise<string> {
  return runInDurableObject(env.AGENTS.getByName(agentId), async (_instance, state) => {
    const local = await openLocalDb(state.storage)
    const memory = {
      env,
      agentId: () => agentId,
      local: () => Promise.resolve(local),
      sharedSpaces: () => Promise.resolve(spaces),
    }
    await refreshAlwaysLoaded(memory)
    return storedMemoryText(memory)
  })
}
