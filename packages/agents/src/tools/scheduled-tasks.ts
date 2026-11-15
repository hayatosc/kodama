/** Model-facing, opt-in reservation tools. Execution and persistence stay with the owning agent.
 * @see docs/agents.md — Scheduled tasks
 * @module
 */
import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-durable'
import type { ToolExecutionApi } from '@earendil-works/pi-durable'
import type { Context } from '@earendil-works/chord/context'
import type { Schedule } from '../agent/schedule-spec.ts'

import type { SessionMode } from '../protocol.ts'

/** Validated model requests, never an operator RPC authorization token. */
export type ScheduleCall =
  | { operation: 'create'; schedule: Schedule; instruction: string; session_mode?: SessionMode }
  | {
      operation: 'list'
      filter?: 'active' | 'paused' | 'completed' | 'cancelled' | 'failed'
      cursor?: string
    }
  | { operation: 'cancel'; task_id: string }
  | {
      operation: 'update'
      task_id: string
      action?: 'pause' | 'resume' | 'edit'
      instruction?: string
      schedule?: Schedule
    }

/** Invocation-bound operations provided by the working agent only. */
export type ScheduleTools = (
  call: ScheduleCall,
  api: ToolExecutionApi,
  context: Context,
) => Promise<string>

const bounds = { start_at: Type.Optional(Type.String()), end_at: Type.Optional(Type.String()) }
const scheduleParameter = Type.Union([
  Type.Object({
    kind: Type.Literal('once'),
    run_at: Type.Optional(Type.String()),
    delay_seconds: Type.Optional(Type.Integer({ minimum: 60, maximum: 31536000 })),
  }),
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
])

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
        'Reserve work for this agent: one-time (run_at or delay_seconds), fixed interval, or five-field numeric cron with explicit IANA timezone. Recurring interval/cron schedules require an owner-only run; one-time follow-ups (kind: "once") may also be created from autonomous runs up to the follow-up hop limit. Missed times coalesce to the latest; one unfinished execution per reservation. Scheduled runs finish silently unless send_outbox is called.',
      replay: 'safe',
      parameters: Type.Object({
        instruction: Type.String({ minLength: 1, maxLength: 16000 }),
        schedule: scheduleParameter,
        session_mode: Type.Optional(Type.Union([Type.Literal('new'), Type.Literal('resume')])),
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
            Type.Literal('paused'),
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
      name: 'update_scheduled_task',
      description:
        "Pause, resume, or revise the instruction or schedule of this agent's reservation. Updating owner recurring schedules requires an owner-only run; follow-up timers may be updated from autonomous runs.",
      replay: 'safe',
      parameters: Type.Object({
        task_id: Type.String({ minLength: 1, maxLength: 100 }),
        action: Type.Optional(
          Type.Union([Type.Literal('pause'), Type.Literal('resume'), Type.Literal('edit')]),
        ),
        instruction: Type.Optional(Type.String({ minLength: 1, maxLength: 16000 })),
        schedule: Type.Optional(scheduleParameter),
      }),
      execute: (args, api, context) => run({ operation: 'update', ...args }, api, context),
    }),
    defineTool({
      name: 'cancel_scheduled_task',
      description:
        "Stop future executions of this agent's reservation. A claimed or admitted current execution may still finish; this never cancels the conversation. Cancelling owner recurring schedules requires an owner-only run.",
      replay: 'safe',
      parameters: Type.Object({ task_id: Type.String({ minLength: 1, maxLength: 100 }) }),
      execute: (args, api, context) => run({ operation: 'cancel', ...args }, api, context),
    }),
  ]
}
