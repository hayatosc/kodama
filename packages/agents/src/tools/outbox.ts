/**
 * Model-facing explicit outbox tool for proactive alerts and deliverable notifications.
 *
 * @see docs/extensions.md — Outbox
 * @module
 */
import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-durable'
import type { ToolExecutionApi } from '@earendil-works/pi-durable'
import type { Context } from '@earendil-works/chord/context'

/** Validated arguments passed to `send_outbox`. */
export interface OutboxCall {
  summary: string
  details?: string
  artifactIds?: string[]
  urgency?: 'normal' | 'immediate'
}

/** Agent-bound delivery handler supplied at harness construction. */
export type OutboxSend = (
  call: OutboxCall,
  api: ToolExecutionApi,
  context: Context,
) => Promise<string>

/**
 * Define `send_outbox` for opt-in working agents.
 * Autonomous scheduled runs stay silent unless this tool is invoked.
 */
export function createOutboxTool(send?: OutboxSend) {
  return defineTool({
    name: 'send_outbox',
    description:
      'Send an explicit alert or deliverable summary to the operator inbox. Only call when there is something actionable or requested to report; otherwise finish the run silently without calling this tool. Consecutive normal alerts within 60 seconds are paced and coalesced; use urgency: "immediate" only for time-critical alerts.',
    replay: 'safe',
    parameters: Type.Object({
      summary: Type.String({ minLength: 1, maxLength: 2048 }),
      details: Type.Optional(Type.String({ minLength: 1, maxLength: 16384 })),
      artifactIds: Type.Optional(
        Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 16 }),
      ),
      urgency: Type.Optional(Type.Union([Type.Literal('normal'), Type.Literal('immediate')])),
    }),
    execute: async (args, api, context) => {
      if (!send) throw new Error('Outbox is unavailable in this runtime')
      return { output: [{ type: 'text' as const, text: await send(args, api, context) }] }
    },
  })
}
