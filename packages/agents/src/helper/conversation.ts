/**
 * A long conversation that compacts, for the pruning tests.
 *
 * @module
 */
import { runInDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/durable-sqlite'
import { vi } from 'vitest'
import { createAgentModels } from '../models/index.ts'
import { piEntries } from '../storage/pi-tables.ts'
import {
  isMemoryAgentRequest,
  isSummaryRequest,
  requestBody,
  textResponse,
  toolCallResponse,
  toolResults,
} from './model.ts'
import { waitForAnswer } from './rpc.ts'

const contextWindow =
  createAgentModels(env).getModel(env.DEFAULT_MODEL_PROVIDER, env.DEFAULT_MODEL_ID)
    ?.contextWindow ?? 0
/** Reported usage at which Pi compacts before the next answer (its default: the context window). */
export const BLOCKING_USAGE = contextWindow
/** Reported usage at which Pi starts compacting in the background (its default). */
export const BACKGROUND_USAGE = contextWindow - 16_384 - 16_000
/** About 4k tokens of text, so a summary keeps the last five turns of 20k tokens. */
export const FILLER = ' filler'.repeat(2_000)

/**
 * Scripted model: answers that report `usage(n)` for the n-th answer request, summaries that wait
 * for `gate()`, and declined memory jobs.
 */
export function mockModel(options: {
  usage: (n: number) => number
  gate?: () => Promise<void> | undefined
  memory?: (body: string) => Response
  /** A scripted answer for the n-th answer request; the default answers `OK`. */
  answer?: (body: string, n: number) => Response | undefined
}) {
  const bodies: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    const body = requestBody(init)
    if (isMemoryAgentRequest(body)) {
      if (options.memory !== undefined) return options.memory(body)
      return toolResults(body) === 0
        ? toolCallResponse({ name: 'memory_decline', arguments: { reason: 'test' } })
        : textResponse('Declined.')
    }
    if (isSummaryRequest(body)) {
      await options.gate?.()
      return textResponse('Summary: the user set a codename and talked at length.')
    }
    bodies.push(body)
    const n = bodies.length - 1
    return options.answer?.(body, n) ?? textResponse('OK', options.usage(n))
  })
  return bodies
}

/** Send a message and wait until it is answered. */
export async function say(agentId: string, requestId: string, content: string) {
  await exports.default.sendMessage(agentId, { requestId, content })
  await waitForAnswer(agentId, requestId)
}

/** Answer 7 reports a full context, so Pi compacts before answer 8. */
export const COMPACT_AFTER_TURN_7 = (n: number) => (n === 7 ? BLOCKING_USAGE : 5)

/** Seven long turns, then one that compacts: entries before the summary's head can be pruned. */
export async function compactedAgent(agentId: string, codename: string) {
  await say(agentId, 't0', `The codename is ${codename}.${FILLER}`)
  for (let turn = 1; turn < 7; turn++) await say(agentId, `t${turn}`, `Turn ${turn}.${FILLER}`)
  await say(agentId, 'big', `Turn 7.${FILLER}`)
  await say(agentId, 'compacts', 'Turn 8.')
}

/** The `head` of the newest head marker in the agent's entries, if any. */
export function headOf(agentId: string): Promise<number | undefined> {
  return runInDurableObject(env.AGENTS.getByName(agentId), (_instance, state) => {
    const row = drizzle(state.storage)
      .select({ head: piEntries.head })
      .from(piEntries)
      .orderBy(piEntries.id)
      .all()
      .findLast((entry) => entry.head !== null)
    return row?.head ?? undefined
  })
}

/** The IDs of the entries the agent still stores. */
export function storedEntryIds(agentId: string): Promise<number[]> {
  return runInDurableObject(env.AGENTS.getByName(agentId), (_instance, state) =>
    drizzle(state.storage)
      .select({ id: piEntries.id })
      .from(piEntries)
      .all()
      .map((row) => row.id),
  )
}
