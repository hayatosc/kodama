/**
 * The Worker's bindings as a type, inferred from `cloudflare.config.ts`.
 *
 * @module
 */
import type { InferEnv } from 'cf/config'
import type { agentConfig } from '../cloudflare.config.ts'

// Keep RPC types independent of the consuming UI Worker's global Env declaration.
/**
 * Bindings, variables, and secrets of the agents Worker.
 *
 * @remarks
 * Inferred from the Worker config rather than the global `Env`, so RPC types stay independent of a
 * consuming UI Worker's own `Env` declaration.
 */
export type AgentEnv = InferEnv<typeof agentConfig> & {
  /** May be removed after every envelope has been rewrapped to V2. */
  CREDENTIAL_KEK_V1?: string
  /** Present only during/after the documented V1-to-V2 KEK replacement. */
  CREDENTIAL_KEK_V2?: string
}
