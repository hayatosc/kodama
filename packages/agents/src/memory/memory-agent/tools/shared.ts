/** The tool that writes shared memory; code checks each write before it is applied. */
import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-durable'
import type { ToolExecutionApi, ToolRegistration } from '@earendil-works/pi-durable'
import { sha256Hex } from '../../../lib/hash.ts'
import { MIN_SOURCE_AGENTS, writeShared } from '../../shared.ts'
import { CONTENT, describe, IMPORTANCE, KIND, text, toolDb } from './common.ts'
import type { MemoryToolDeps } from './common.ts'

export function sharedTools(deps: MemoryToolDeps): ToolRegistration[] {
  return [
    defineTool({
      name: 'shared_write',
      description: `Write a record to a shared space, new or replacing a shared record by id. Code applies it only when the cited sources are active records of at least ${MIN_SOURCE_AGENTS} agents, or only records of that space.`,
      parameters: Type.Object({
        space: Type.String({ pattern: '^[a-z0-9-]{1,64}$' }),
        kind: KIND,
        content: CONTENT,
        importance: IMPORTANCE,
        required: Type.Optional(
          Type.Boolean({ description: 'A team rule agents cannot override' }),
        ),
        replaces: Type.Optional(
          Type.String({ description: 'ID of the shared record it replaces' }),
        ),
        sourceIds: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), {
          minItems: 1,
          maxItems: 20,
        }),
      }),
      replay: 'safe',
      execute: async (args, api: ToolExecutionApi) => {
        const running = await deps.runningJob()
        if (running?.job.kind !== 'consolidate') {
          throw new Error('shared_write needs a consolidate job')
        }
        const result = await writeShared(
          toolDb(deps),
          {
            opId: await sha256Hex(`${running.jobId}:${api.callId}`),
            jobId: running.jobId,
            runId: running.jobId,
            actor: 'memory-agent',
            now: deps.now?.() ?? Date.now(),
          },
          args,
        )
        return text(result.status === 'rejected' ? `rejected: ${result.reason}` : describe(result))
      },
    }),
  ]
}
