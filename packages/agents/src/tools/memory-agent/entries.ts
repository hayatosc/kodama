/**
 * Tools that read an agent's entries: an extract job's pages and checkpoint, and a record_archive job's segment and summary.
 *
 * @module
 */
import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-durable'
import type { ToolRegistration } from '@earendil-works/pi-durable'
import { text, writingTool } from './common.ts'
import type { MemoryJobDeps } from '../../memory/job-context.ts'
import {
  readExtractionEntries,
  readJobArchive,
  writeJobArchiveSummary,
} from '../../memory/job-entries.ts'

/** The tools of an extract job: `read_entries` and `finish_extraction`. */
export function extractionTools(deps: MemoryJobDeps): ToolRegistration[] {
  const readEntries = defineTool({
    name: 'read_entries',
    description: 'Read the source agent entries of an extract job, oldest first.',
    parameters: Type.Object({
      after: Type.Optional(Type.Integer({ minimum: 0, description: 'Read entries after this ID' })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    }),
    replay: 'safe',
    execute: async ({ after, limit }) => {
      const page = await readExtractionEntries(deps, after, limit)
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

/** The tools of a record_archive job: reading the archived segment and writing its summary. */
export function archiveTools(deps: MemoryJobDeps): ToolRegistration[] {
  const readArchive = defineTool({
    name: 'read_archive',
    description: 'Read the entries of the archived segment of a record_archive job, oldest first.',
    parameters: Type.Object({
      after: Type.Optional(Type.Integer({ minimum: 0, description: 'Read entries after this ID' })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    }),
    replay: 'safe',
    execute: async ({ after, limit }) => {
      const { page, lastEntry } = await readJobArchive(deps, after, limit)
      const lines = page.entries.map((entry) => `#${entry.id} ${entry.role}: ${entry.text}`)
      lines.push(
        page.through === undefined || page.through >= lastEntry
          ? `(end of segment, through #${lastEntry})`
          : `(more after #${page.through})`,
      )
      return text(lines.join('\n'))
    },
  })
  const SUMMARY = Type.String({ minLength: 1, maxLength: 4_000 })
  const writeArchiveSummary = writingTool(deps, {
    name: 'write_archive_summary',
    description: 'Store the summary of the archived segment of a record_archive job.',
    parameters: Type.Object({ summary: SUMMARY }),
    prepare: async (args, job) => {
      if (job.kind !== 'record_archive')
        throw new Error('write_archive_summary needs a record_archive job')
      await writeJobArchiveSummary(deps, args.summary)
    },
    operation: (_args, job) => {
      if (job.kind !== 'record_archive')
        throw new Error('write_archive_summary needs a record_archive job')
      return { type: 'archive_summary', segmentId: job.segmentId }
    },
  })

  return [readArchive, writeArchiveSummary]
}
