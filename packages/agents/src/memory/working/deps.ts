/**
 * What a working agent's memory needs from the agent object.
 *
 * @module
 */
import type { AgentEnv } from '../../env.ts'
import type { LocalDb } from '../../storage/local.ts'

/** What a working agent's memory needs from the agent object. */
export interface WorkingMemoryDeps {
  env: Pick<AgentEnv, 'MEMORY_DB' | 'MEMORY_AGENT' | 'ARCHIVE'>
  agentId: () => string
  local: () => Promise<LocalDb>
  /** Shared spaces the agent reads, earliest first. */
  sharedSpaces: () => Promise<readonly string[]>
  now?: () => number
}
