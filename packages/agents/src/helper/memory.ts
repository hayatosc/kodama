/**
 * Helpers of the long-term memory tests: the memory database, records, and the memory agent.
 *
 * @module
 */
import { uuidv7 } from '../lib/uuid.ts'
import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { and, eq } from 'drizzle-orm'
import { beforeAll, vi } from 'vitest'
import { seedOnce } from './management.ts'

beforeAll(seedOnce)
import { drizzle } from 'drizzle-orm/d1'
import { MEMORY_AGENT_NAME } from '../memory/jobs.ts'
import { memoryDb, schema } from '../memory/store/db.ts'
import { applyOperation } from '../memory/store/records.ts'
import type { NewRecord } from '../memory/store/records.ts'
import { memoryRecords } from '../../drizzle/memory/schema.ts'
import type { OperationContext } from '../memory/store/statements.ts'
import { refreshAlwaysLoaded, storedMemoryText } from '../memory/working/always-loaded.ts'
import { alwaysLoaded } from '../../drizzle/durable-object/schema.ts'
import { openLocalDb } from '../storage/local.ts'
import type { MemoryJob } from '../memory/jobs.ts'
import {
  isMemoryAgentRequest,
  requestBody,
  textResponse,
  toolCallResponse,
  toolResults,
} from './model.ts'
import type { ToolCall } from './model.ts'

/** The memory database of the tests. */
export const db = memoryDb(env.MEMORY_DB)
/** Real D1 queries with the production parameter limit enforced even in the local emulator. */
export const parameterLimitedDb = drizzle(env.MEMORY_DB, {
  schema,
  logger: {
    logQuery(_query, params) {
      if (params.length > 100)
        throw new Error(`D1 parameter limit exceeded: ${params.length} > 100`)
    },
  },
})
/**
 * Interleave one write after a real record query has captured its rows: the next one, or the one
 * after `skip` others.
 */
export function afterNextMemoryRecordsRead(
  database: D1Database,
  write: () => Promise<void>,
  skip = 0,
): void {
  const prepare = database.prepare.bind(database)
  let remaining = skip
  const prepareSpy = vi.spyOn(database, 'prepare').mockImplementation((query) => {
    const statement = prepare(query)
    if (!query.startsWith('select ') || !query.includes('from "memory_records"')) return statement
    if (remaining-- > 0) return statement
    prepareSpy.mockRestore()
    const bind = statement.bind.bind(statement)
    vi.spyOn(statement, 'bind').mockImplementation((...values) => {
      const bound = bind(...values)
      const raw = bound.raw.bind(bound)
      vi.spyOn(bound, 'raw').mockImplementation(
        async <T = unknown[]>(options?: { columnNames?: false }) => {
          const rows = await raw<T>(options)
          await write()
          return rows
        },
      )
      return bound
    })
    return statement
  })
}

/** The memory agent's stub. */
export const memoryAgent = () => env.AGENTS.getByName(MEMORY_AGENT_NAME)

/** A fresh operation, as if from its own job. */
export function context(now = Date.now()): OperationContext {
  const opId = uuidv7()
  return { opId, jobId: opId, runId: opId, actor: 'test', now }
}

/** Write a record directly, as the memory agent would; returns its ID. */
export async function write(record: Omit<NewRecord, 'origin' | 'observedAt'>): Promise<string> {
  const result = await applyOperation(db, context(), {
    type: 'write',
    record: { origin: 'remember', observedAt: Date.now(), ...record },
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

/** The text of every tool result a Responses request body carries, in order. */
function toolOutputs(body: string): string[] {
  const parsed: unknown = JSON.parse(body)
  if (typeof parsed !== 'object' || parsed === null || !('input' in parsed)) return []
  const input: unknown = parsed.input
  if (!Array.isArray(input)) return []
  const texts: string[] = []
  for (const item of input) {
    if (typeof item !== 'object' || item === null) continue
    if (!('type' in item) || item.type !== 'function_call_output' || !('output' in item)) continue
    const output: unknown = item.output
    if (typeof output === 'string') texts.push(output)
    else texts.push(JSON.stringify(output))
  }
  return texts
}

/**
 * Run a memory job whose model makes `calls` one per step, then finishes.
 *
 * @returns The job's status and the output of each tool call, in order.
 */
export async function runScriptedJob(job: MemoryJob, calls: readonly ToolCall[]) {
  let last = ''
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    const body = requestBody(init)
    if (!isMemoryAgentRequest(body)) return textResponse('OK')
    last = body
    const call = calls[toolResults(body)]
    return call === undefined ? textResponse('Finished.') : toolCallResponse(call)
  })
  const { jobId } = await memoryAgent().enqueue(job)
  let status = await memoryAgent().jobStatus(jobId)
  for (const deadline = Date.now() + 10_000; status?.status !== 'settled';) {
    if (Date.now() > deadline) throw new Error(`Job ${jobId} did not settle`)
    await new Promise((resolve) => setTimeout(resolve, 50))
    status = await memoryAgent().jobStatus(jobId)
  }
  return { status, outputs: toolOutputs(last) }
}
