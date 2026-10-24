/**
 * Select the working or system agent for an object in the single `AGENTS` namespace.
 * System agents use reserved names, not a Durable Object class or binding of their own.
 *
 * @see docs/agents.md — Dedicated agents
 *
 * @module
 */
import type { AgentEnv } from './env.ts'
import { MEMORY_AGENT_NAME } from './memory/jobs.ts'
import { Agent } from './runtime/agent.ts'
import { MemoryAgent } from './system-agents/memory/agent.ts'

/** The class each reserved name is constructed as. Reserved names are not public agent IDs. */
const DEDICATED_AGENTS: ReadonlyMap<string, typeof Agent> = new Map([
  [MEMORY_AGENT_NAME, MemoryAgent],
])

/**
 * The Durable Object class exported as `Agent` and bound as `AGENTS`.
 *
 * @remarks
 * The constructor returns the dedicated agent registered under the object's name, so the runtime
 * holds that subclass; any other name becomes a working `Agent`.
 */
export class AgentObject extends Agent {
  constructor(ctx: DurableObjectState, env: AgentEnv) {
    const Dedicated = ctx.id.name === undefined ? undefined : DEDICATED_AGENTS.get(ctx.id.name)
    if (Dedicated !== undefined) return new Dedicated(ctx, env)
    super(ctx, env)
  }
}
