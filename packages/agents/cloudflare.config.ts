import { bindings, defineConfig, defineWorker, exports } from 'cf/config'
import * as entrypoint from './src/index.ts' with { type: 'cf-worker' }
import * as cliEntrypoint from './cli/worker.ts' with { type: 'cf-worker' }
import { createLocalToken } from './cli/token.ts'

const agentWorker = defineWorker({
  name: 'kodama-agents',
  entrypoint,
  compatibilityDate: '2026-10-01',
  exports: { Agent: exports.durableObject({ storage: 'sqlite' }) },
  workersDev: false,
  observability: { enabled: true },
})

export const agentConfig = defineWorker({
  ...agentWorker,
  env: {
    AGENTS: bindings.durableObject({ worker: agentWorker, exportName: 'Agent' }),
    MEMORY_DB: bindings.d1({ name: 'kodama-memory' }),
    ARCHIVE: bindings.r2({ name: 'kodama-archive' }),
    DEFAULT_MODEL_PROVIDER: bindings.text('openai'),
    DEFAULT_MODEL_ID: bindings.text('gpt-6-luna'),
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
