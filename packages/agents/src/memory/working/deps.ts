/**
 * What a working agent's memory needs from the agent object.
 *
 * @module
 */
import type { AgentEnv } from '../../env.ts'
import type { LocalDb } from '../../agent/local-db/local.ts'

/** What a working agent's memory needs from the agent object. */
export interface WorkingMemoryDeps {
  /** Serialize remember enqueue with permanent contact admission. */
  trusted?: <T>(operation: () => Promise<T>) => Promise<T>
  env: Pick<AgentEnv, 'MEMORY_DB' | 'AGENTS' | 'ARCHIVE'>
  agentId: () => string
  local: () => Promise<LocalDb>
  /** Shared spaces the agent reads, earliest first. */
  sharedSpaces: () => Promise<readonly string[]>
  now?: () => number
}
