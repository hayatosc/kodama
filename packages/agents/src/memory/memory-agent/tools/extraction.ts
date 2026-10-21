/** Tools of an extract job: paging through the source entries and the checkpoint. */
import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-durable'
import type { ToolRegistration } from '@earendil-works/pi-durable'
import { text, writingTool } from './common.ts'
import type { MemoryToolDeps } from './common.ts'

export function extractionTools(deps: MemoryToolDeps): ToolRegistration[] {
  const readEntries = defineTool({
    name: 'read_entries',
    description: 'Read the source agent entries of an extract job, oldest first.',
    parameters: Type.Object({
      after: Type.Optional(Type.Integer({ minimum: 0, description: 'Read entries after this ID' })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    }),
    replay: 'safe',
    execute: async ({ after, limit }) => {
      const running = await deps.runningJob()
      if (running?.job.kind !== 'extract') throw new Error('read_entries needs an extract job')
      const { job } = running
      const page = await deps.env.AGENTS.getByName(job.sourceAgentId).readEntries({
        after: Math.max(after ?? job.afterEntry, job.afterEntry),
        limit: limit ?? 50,
      })
      const lines = page.entries.map((entry) => `#${entry.id} ${entry.role}: ${entry.text}`)
      lines.push(
        page.end ? `(end of entries, through #${page.through})` : `(more after #${page.through})`,
      )
      return text(lines.join('\n'))
    },
  })
  const finishExtraction = writingTool(deps, {
    name: 'finish_extraction',
    description: 'Record that the extract job has covered entries through lastEntryId.',
    parameters: Type.Object({ lastEntryId: Type.Integer({ minimum: 0 }) }),
    operation: (args, job) => {
      if (job.kind !== 'extract') throw new Error('finish_extraction needs an extract job')
      return {
        type: 'checkpoint',
        agentId: job.sourceAgentId,
        lastEntryId: Math.max(args.lastEntryId, job.afterEntry),
      }
    },
  })

  return [readEntries, finishExtraction]
}
