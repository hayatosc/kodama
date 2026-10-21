import { configure, createRegistry, defineExtension } from '@earendil-works/pi-durable'
import type { HarnessOptions } from '@earendil-works/pi-durable'
import { agentChange, defaultAgentConfig } from './configuration/index.ts'
import type { DefaultModelEnv } from './configuration/index.ts'
import { createAgentModels } from './models/index.ts'
import type { ModelProviderEnv } from './models/index.ts'
import { agentTools } from './tools/index.ts'

/** A request that stalls this long fails as a timeout, which the retry policy then waits out. */
const MODEL_REQUEST_TIMEOUT_MS = 300_000

/**
 * Pi commits partial answers and tool output at most this often. Each commit writes rows, which
 * are the largest storage cost while streaming; test/measurement.test.ts records rows per turn.
 */
export const PROGRESS_INTERVAL_MS = 100

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

/** Compose registered capabilities; persisted per-agent choices select what is enabled. */
export function createAgentOptions(env: DefaultModelEnv & ModelProviderEnv): HarnessOptions {
  const extension = defineExtension({ name: 'kodama', tools: agentTools })
  const registry = createRegistry()
  registry.install(extension)
  return {
    models: createAgentModels(env),
    registry,
    // Disable cache retention timers so idle agents can be evicted, including in workerd tests.
    settings: {
      extensions: [extension],
      documentRetentionMs: 0,
      contextRetentionMs: 0,
      stream: { timeoutMs: MODEL_REQUEST_TIMEOUT_MS },
      retry: RETRY_POLICY,
      progress: { partialIntervalMs: PROGRESS_INTERVAL_MS, outputIntervalMs: PROGRESS_INTERVAL_MS },
    },
    conversationCreated: (tx, conversation) =>
      conversation.owner === undefined && conversation.parent === undefined
        ? configure(tx, conversation.id, agentChange(defaultAgentConfig(env)))
        : undefined,
  }
}
