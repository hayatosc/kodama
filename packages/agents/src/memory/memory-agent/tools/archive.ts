/** Tools of a record_archive job: reading an archived segment and storing its summary. */
import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-durable'
import type { ToolRegistration } from '@earendil-works/pi-durable'
import { eq } from 'drizzle-orm'
import { readArchivedText } from '../../archive/reader.ts'
import { writeSummary } from '../../archive/segment.ts'
import { looksLikeInjection, redactSecrets } from '../../redact.ts'
import type { MemoryDb } from '../../store/db.ts'
import { archiveSegments } from '../../../../drizzle/d1/schema/archive.ts'
import { text, toolDb, writingTool } from './common.ts'
import type { MemoryToolDeps } from './common.ts'

export function archiveTools(deps: MemoryToolDeps): ToolRegistration[] {
  const db = (): MemoryDb => toolDb(deps)
  const archivedSegment = async () => {
    const running = await deps.runningJob()
    if (running?.job.kind !== 'record_archive')
      throw new Error('This tool needs a record_archive job')
    const segment = await db()
      .select()
      .from(archiveSegments)
      .where(eq(archiveSegments.id, running.job.segmentId))
      .get()
    if (segment === undefined)
      throw new Error(`Archived segment ${running.job.segmentId} is missing`)
    return segment
  }
  const readArchive = defineTool({
    name: 'read_archive',
    description: 'Read the entries of the archived segment of a record_archive job, oldest first.',
    parameters: Type.Object({
      after: Type.Optional(Type.Integer({ minimum: 0, description: 'Read entries after this ID' })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    }),
    replay: 'safe',
    execute: async ({ after, limit }) => {
      const segment = await archivedSegment()
      const page = await readArchivedText(
        deps.env.ARCHIVE,
        segment.r2Prefix,
        after ?? 0,
        limit ?? 50,
      )
      const lines = page.entries.map((entry) => `#${entry.id} ${entry.role}: ${entry.text}`)
      lines.push(
        page.through === undefined || page.through >= segment.lastEntry
          ? `(end of segment, through #${segment.lastEntry})`
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
      const summary = redactSecrets(args.summary.trim())
      if (looksLikeInjection(summary))
        throw new Error('The summary looks like an instruction to obey')
      const segment = await archivedSegment()
      await writeSummary(deps.env.ARCHIVE, segment.r2Prefix, summary)
    },
    operation: (_args, job) => {
      if (job.kind !== 'record_archive')
        throw new Error('write_archive_summary needs a record_archive job')
      return { type: 'archive_summary', segmentId: job.segmentId }
    },
  })

  return [readArchive, writeArchiveSummary]
}
