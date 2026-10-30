/**
 * Memory tool schemas, model-facing output, and the adapter to replay-safe job operations.
 *
 * @module
 */
import { Type } from '@earendil-works/pi-ai'
import type { Static, TSchema } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-durable'
import type { ToolExecutionApi, ToolRegistration } from '@earendil-works/pi-durable'
import type { MemoryJobDeps } from '../../../memory/extraction/context.ts'
import { executeJobOperation } from '../../../memory/extraction/operations.ts'
import type { MemoryJob } from '../../../memory/jobs.ts'
import type { MemoryRecord } from '../../../memory/store/db.ts'
import type { Operation } from '../../../memory/store/records.ts'
import type { OperationResult } from '../../../memory/store/statements.ts'

/** The kind of a record. */
export const KIND = Type.Union([
  Type.Literal('fact'),
  Type.Literal('instruction'),
  Type.Literal('event'),
  Type.Literal('task'),
])
/** The text of a record, 1–2,000 characters. */
export const CONTENT = Type.String({ minLength: 1, maxLength: 2_000 })
/** How much a record matters, from 0 to 1. */
export const IMPORTANCE = Type.Optional(Type.Number({ minimum: 0, maximum: 1 }))
/** The shared record an agent record replaces for that agent. */
export const OVERRIDES = Type.Optional(
  Type.String({
    minLength: 1,
    description: 'ID of a shared record this agent record replaces for the agent only',
  }),
)
/** An entry ID an extract job cites as evidence. */
export const ENTRY = Type.Optional(
  Type.Integer({ minimum: 0, description: 'Entry ID; extraction cites its entries' }),
)

/** A tool result of one text block. */
export function text(value: string) {
  return { output: [{ type: 'text' as const, text: value }] }
}

/** Records as lines the model can cite by `id` and `revision`. */
export function formatRecords(records: readonly MemoryRecord[]): string {
  if (records.length === 0) return 'No matching records.'
  return records
    .map(
      (record) =>
        `- id=${record.id} revision=${record.revision} scope=${record.scope} kind=${record.kind}` +
        ` entries<=${record.sourceEntryTo ?? '-'}: ${record.content}`,
    )
    .join('\n')
}

/** An operation result as one line for the model, telling it what to do on a conflict. */
export function describe(result: OperationResult & { replayed: boolean }): string {
  switch (result.status) {
    case 'applied':
      return `applied ${result.recordId}`
    case 'declined':
      return 'declined'
    case 'stale':
      return 'stale: the record rests on newer entries; the candidate was declined'
    case 'conflict':
      return `conflict (${result.reason}): search again and retry against the current record`
  }
}

/** Adapt a tool call to a job operation; job policy and persistence live below this layer. */
export function writingTool<P extends TSchema>(
  deps: MemoryJobDeps,
  definition: {
    name: string
    description: string
    parameters: P
    operation: (args: Static<P>, job: MemoryJob, now: number) => Operation
  },
): ToolRegistration {
  return defineTool({
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    replay: 'safe',
    execute: async (args, api: ToolExecutionApi) => {
      const result = await executeJobOperation(deps, api.callId, (job, now) =>
        definition.operation(args, job, now),
      )
      return text(describe(result))
    },
  })
}
