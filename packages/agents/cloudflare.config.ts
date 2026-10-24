/**
 * Worker bindings, secrets, and the Durable Object's SQLite storage.
 *
 * @module
 */
import { bindings, defineConfig, defineWorker, exports, triggers } from 'cf/config'
import * as entrypoint from './src/index.ts' with { type: 'cf-worker' }
import * as cliEntrypoint from './cli/worker.ts' with { type: 'cf-worker' }
import { createLocalToken } from './cli/token.ts'

const agentWorker = defineWorker({
  name: 'kodama-agents',
  entrypoint,
  compatibilityDate: '2026-10-01',
  exports: {
    Agent: exports.durableObject({ storage: 'sqlite' }),
    // Administration for the UI Worker and the development CLI (src/admin/index.ts).
    AdminService: exports.worker(),
  },
  // Daily reconciliation (src/admin/reconcile.ts), then memory consolidation
  // (src/memory/consolidation.ts).
  triggers: [triggers.scheduled({ schedule: '17 3 * * *' })],
  workersDev: false,
  observability: { enabled: true },
})

/** The agent Worker with its bindings and secrets. */
export const agentConfig = defineWorker({
  ...agentWorker,
  env: {
    AGENTS: bindings.durableObject<typeof agentWorker, 'Agent'>({
      worker: agentWorker,
      exportName: 'Agent',
    }),
    /** The control database: the agent registry, configuration versions, members, and audit. */
    CONTROL_DB: bindings.d1({ name: 'kodama-control' }),
    /** Long-term memory. */
    MEMORY_DB: bindings.d1({ name: 'kodama-memory' }),
    ARCHIVE: bindings.r2({ name: 'kodama-archive' }),
    DEFAULT_MODEL_PROVIDER: bindings.text('openai'),
    DEFAULT_MODEL_ID: bindings.text('gpt-6-luna'),
    // The memory agent's initial model, read by the seed; empty values use the default model above.
    MEMORY_MODEL_PROVIDER: bindings.text(''),
    MEMORY_MODEL_ID: bindings.text(''),
    OPENAI_API_KEY: bindings.secret(),
    ANTHROPIC_API_KEY: bindings.secret(),
    GEMINI_API_KEY: bindings.secret(),
    XAI_API_KEY: bindings.secret(),
    CLI_TOKEN: bindings.text(''),
  },
})

export default defineConfig({
  worker: ({ mode }) => ({
    ...agentConfig,
    entrypoint: mode === 'development' ? cliEntrypoint : entrypoint,
    env: {
      ...agentConfig.env,
      CLI_TOKEN: bindings.text(mode === 'development' ? createLocalToken() : ''),
    },
  }),
})
