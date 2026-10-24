/**
 * Agent lifecycle states: what each state lets an agent do. The registry's
 * `agents.status` is the source; each object holds a copy, set through `Agent.setStatus`.
 *
 * @see docs/agents.md — Lifecycle
 *
 * @module
 */
import type { AgentStatus } from '../protocol.ts'

/** What a public call wants to do with an agent. */
export type AgentUse = 'chat' | 'read'

/** The states that admit each use through `AgentService`. */
export const ADMITTED_STATUSES: Readonly<Record<AgentUse, readonly AgentStatus[]>> = {
  chat: ['active'],
  read: ['active', 'pausing', 'paused', 'archived'],
}

/**
 * The states in which an object may make external calls: model requests, tool calls, and messages
 * to other agents. Any other state stops the next such call, even in the middle of a turn.
 */
export const CALLING_STATUSES: readonly AgentStatus[] = ['provisioning', 'active']
