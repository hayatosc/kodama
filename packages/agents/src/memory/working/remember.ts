/**
 * Accept a working agent's remember request after claiming its per-turn quota.
 *
 * @see docs/memory.md — Working agents
 *
 * @module
 */
import { claimRememberTurn } from '../../storage/memory.ts'
import { MEMORY_AGENT_NAME } from '../jobs.ts'
import type { WorkingMemoryDeps } from './deps.ts'

/** Remember requests a working agent may make in one turn. */
export const REMEMBER_LIMIT_PER_TURN = 3

/**
 * Attribute a request to the user turn, consume the quota, and enqueue it for the memory agent.
 * The quota remains consumed if enqueue fails, as it does for a replayed tool call.
 *
 * @throws {@link Error} When there is no user entry or the turn has exhausted its quota.
 */
export async function requestRemember(
  deps: WorkingMemoryDeps,
  userEntry: number | undefined,
  content: string,
  origin: 'user_request' | 'agent_judgment',
) {
  if (userEntry === undefined) throw new Error('Not saved: no user message to attribute it to')
  const local = await deps.local()
  if (!claimRememberTurn(local, userEntry, REMEMBER_LIMIT_PER_TURN)) {
    throw new Error(`Not saved: at most ${REMEMBER_LIMIT_PER_TURN} memories per turn`)
  }
  return deps.env.AGENTS.getByName(MEMORY_AGENT_NAME).enqueue({
    kind: 'remember',
    sourceAgentId: deps.agentId(),
    origin,
    content: content.trim(),
    sourceEntries: { from: userEntry, to: userEntry },
  })
}
