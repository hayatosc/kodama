/**
 * The Pi harness of an agent: its options and settings, opening it, and the exclusive section in
 * which pruning closes and reopens it.
 *
 * @see docs/agents.md — Harness
 *
 * @module
 */
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { configure, createRegistry, defineExtension, Harness } from '@earendil-works/pi-durable'
import type { Extension, HarnessOptions } from '@earendil-works/pi-durable'
import { agentChange, defaultAgentConfig } from '../configuration/index.ts'
import type { DefaultModelEnv } from '../configuration/index.ts'
import { createAgentModels } from '../models/index.ts'
import type { ModelProviderEnv } from '../models/index.ts'
import { openDurableObjectSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/cloudflare'
import { agentTools } from '../tools/index.ts'

const context = BACKGROUND_CONTEXT

/** A request that stalls this long fails as a timeout, which the retry policy then waits out. */
const MODEL_REQUEST_TIMEOUT_MS = 300_000

/**
 * Like opencode, transient provider failures (rate limits, 5xx, timeouts, dropped connections) are retried
 * without an attempt limit, backing off from 2s to at most 30s. Non-retryable errors such as invalid
 * credentials or exhausted quota still settle the submission as unanswered at once.
 */
const RETRY_POLICY = {
  enabled: true,
  maxRetries: Number.MAX_SAFE_INTEGER,
  baseDelayMs: 2_000,
  maxAgentDelayMs: 30_000,
}

/**
 * Settings shared by working agents and the memory agent.
 *
 * @param extensions - Every extension the agent's registry holds.
 */
export function harnessSettings(extensions: readonly Extension[]): HarnessOptions['settings'] {
  return {
    extensions: [...extensions],
    // Disable cache retention timers so idle agents can be evicted, including in workerd tests.
    documentRetentionMs: 0,
    contextRetentionMs: 0,
    stream: { timeoutMs: MODEL_REQUEST_TIMEOUT_MS },
    retry: RETRY_POLICY,
  }
}

/**
 * A working agent's harness options. The agent's stored tool choice selects which registered
 * tools are enabled.
 *
 * @param always - Extensions that stay enabled whatever tools the agent selects, such as its memory.
 */
export function createAgentOptions(
  env: DefaultModelEnv & ModelProviderEnv,
  always: readonly Extension[] = [],
): HarnessOptions {
  const extension = defineExtension({ name: 'kodama', tools: agentTools })
  const registry = createRegistry()
  registry.install(extension)
  for (const extra of always) registry.install(extra)
  return {
    models: createAgentModels(env),
    registry,
    settings: harnessSettings([extension, ...always]),
    conversationCreated: (tx, conversation) =>
      conversation.owner === undefined && conversation.parent === undefined
        ? configure(tx, conversation.id, agentChange(defaultAgentConfig(env)))
        : undefined,
  }
}

/**
 * Open the harness on the object's SQLite and run `prepare` before anything else sees it.
 *
 * @remarks
 * If `prepare` throws, the harness is closed and the error rethrown. If Pi's storage later fails,
 * the object aborts, and the next request recreates it.
 */
export async function openHarness(
  ctx: DurableObjectState,
  options: HarnessOptions,
  prepare: (harness: Harness) => Promise<void>,
): Promise<Harness> {
  const storage = await openDurableObjectSqliteStorage(ctx.storage)
  const harness = await Harness.open(
    storage,
    { ...options, onReport: (error) => console.error('Agent background task failed', error) },
    context,
  )
  void harness.closed.then((end) => {
    if (end.reason === 'failed') ctx.abort('Agent storage failed')
  })
  try {
    await prepare(harness)
    return harness
  } catch (error) {
    await harness.close(context)
    throw error
  }
}

/** Whether no task is left and no input or write is queued. */
export async function isIdle(harness: Harness): Promise<boolean> {
  const { tasks, submissions } = await harness.inspect(context)
  return tasks.length === 0 && submissions.length === 0
}

/**
 * With every other event held back, run `check` against the open harness; if it passes, close
 * the harness, run `mutate` in one storage transaction, and reopen it.
 *
 * @param current - The harness in use now.
 * @param reopen - Opens and prepares the harness again.
 * @returns The harness to use from now on, and whether `mutate` ran.
 *
 * @remarks
 * A failure after the harness closes throws out of `blockConcurrencyWhile`, which resets the
 * object; its next request opens the harness again.
 */
export function exclusiveSection(
  ctx: DurableObjectState,
  current: Promise<Harness>,
  check: (harness: Harness) => Promise<boolean>,
  mutate: () => void,
  reopen: () => Promise<Harness>,
): Promise<{ harness: Harness; mutated: boolean }> {
  return ctx.blockConcurrencyWhile(async () => {
    const harness = await current
    if (!(await check(harness))) return { harness, mutated: false }
    await harness.close(context)
    // A failure here throws out of blockConcurrencyWhile, which resets the object.
    ctx.storage.transactionSync(mutate)
    return { harness: await reopen(), mutated: true }
  })
}
