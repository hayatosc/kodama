/** Memory scopes: an agent's own, and the shared spaces it reads (Scopes). */
import type { Scope } from './schema/records.ts'

export function agentScope(agentId: string): Scope {
  return `agent:${agentId}`
}

export function readableScopes(agentId: string, sharedSpaces: readonly string[]): Scope[] {
  return [agentScope(agentId), ...sharedSpaces.map((space): Scope => `shared:${space}`)]
}

const SCOPE_PATTERN = /^(?:agent|shared):[a-zA-Z0-9_-]{1,64}$/

/** `agent:<id>` or `shared:<space>`. */
export function isScope(value: unknown): value is Scope {
  return typeof value === 'string' && SCOPE_PATTERN.test(value)
}
