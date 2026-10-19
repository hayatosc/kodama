import type { InferEnv } from 'cf/config'
import type { agentConfig } from '../cloudflare.config.ts'

// Keep RPC types independent of the consuming UI Worker's global Env declaration.
export type AgentEnv = InferEnv<typeof agentConfig>
