/** Model-facing, opt-in reservation tools. Execution and persistence stay with the owning agent.
 * @see docs/agents.md — Scheduled tasks
 * @module
 */
import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-durable'
import type { ToolExecutionApi } from '@earendil-works/pi-durable'
import type { Context } from '@earendil-works/chord/context'
import type { Schedule } from '../agent/schedule-spec.ts'

/** Validated model requests, never an operator RPC authorization token. */
export type ScheduleCall =
  | { operation: 'create'; schedule: Schedule; instruction: string }
  | { operation: 'list'; filter?: 'active' | 'completed' | 'cancelled' | 'failed'; cursor?: string }
  | { operation: 'cancel'; task_id: string }
/** Invocation-bound operations provided by the working agent only. */
export type ScheduleTools = (
  call: ScheduleCall,
  api: ToolExecutionApi,
  context: Context,
) => Promise<string>

const bounds = { start_at: Type.Optional(Type.String()), end_at: Type.Optional(Type.String()) }

/** Register the same schemas for discovery and execution; mutations are idempotent by tool task. */
export function createScheduleTools(execute?: ScheduleTools) {
  const run = async (call: ScheduleCall, api: ToolExecutionApi, context: Context) => {
    if (!execute) throw new Error('Scheduling is unavailable in this runtime')
    return { output: [{ type: 'text' as const, text: await execute(call, api, context) }] }
  }
  return [
    defineTool({
      name: 'schedule_task',
      description:
        'Reserve work for this agent, once, at a fixed interval, or by a five-field numeric cron and explicit IANA timezone. Ask when timezone is unknown. Mutations require an owner-only current run, not a scheduled or peer run. Missed times coalesce to the latest; one unfinished execution per reservation. No external notifications. Web access follows normal URL rules.',
      replay: 'safe',
      parameters: Type.Object({
        instruction: Type.String({ minLength: 1, maxLength: 16000 }),
        schedule: Type.Union([
          Type.Object({ kind: Type.Literal('once'), run_at: Type.String() }),
          Type.Object({
            kind: Type.Literal('interval'),
            every_seconds: Type.Integer({ minimum: 60, maximum: 31536000 }),
            ...bounds,
          }),
          Type.Object({
            kind: Type.Literal('cron'),
            expression: Type.String({ maxLength: 256 }),
            timezone: Type.String({ maxLength: 100 }),
            ...bounds,
          }),
        ]),
      }),
      execute: (args, api, context) => run({ operation: 'create', ...args }, api, context),
    }),
    defineTool({
      name: 'list_scheduled_tasks',
      description:
        "List this agent's reservations, next nominal times and retained execution receipts. submitted means accepted, not successful. Pass nextCursor to continue.",
      replay: 'safe',
      parameters: Type.Object({
        filter: Type.Optional(
          Type.Union([
            Type.Literal('active'),
            Type.Literal('completed'),
            Type.Literal('cancelled'),
            Type.Literal('failed'),
          ]),
        ),
        cursor: Type.Optional(Type.String({ maxLength: 100 })),
      }),
      execute: (args, api, context) => run({ operation: 'list', ...args }, api, context),
    }),
    defineTool({
      name: 'cancel_scheduled_task',
      description:
        "Stop future executions of this agent's reservation. A claimed or admitted current execution may still finish; this never cancels the conversation. Requires an owner-only current run.",
      replay: 'safe',
      parameters: Type.Object({ task_id: Type.String({ minLength: 1, maxLength: 100 }) }),
      execute: (args, api, context) => run({ operation: 'cancel', ...args }, api, context),
    }),
  ]
}
