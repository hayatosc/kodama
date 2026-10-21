/** Tools of the memory agent; working agents never get them. */
import { Type } from '@earendil-works/pi-ai'
import type { Static, TSchema } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-durable'
import type { ToolExecutionApi, ToolRegistration } from '@earendil-works/pi-durable'
import { and, eq } from 'drizzle-orm'
import type { AgentEnv } from '../env.ts'
import { readArchivedText, writeSummary } from './archive.ts'
import { consolidationRecords } from './consolidation.ts'
import type { MemoryJob } from './jobs.ts'
import { applyOperation, memoryDb, searchMemory } from './records.ts'
import type {
  MemoryDb,
  MemoryRecord,
  NewRecord,
  Operation,
  OperationResult,
  RecordKind,
  Scope,
} from './records.ts'
import { looksLikeInjection, redactSecrets } from './redact.ts'
import { archiveSegments, skills as skillsTable } from './schema.ts'
import { propose, skillFilesAsBlobs } from './proposals.ts'
import { setSkillStatus, skillDir, writeSkill } from './skills.ts'

export interface RunningJob {
  jobId: string
  job: MemoryJob
}

export interface MemoryToolDeps {
  env: AgentEnv
  /** The job being run; tools refuse to write outside a job. */
  runningJob: () => Promise<RunningJob | undefined>
  now?: () => number
}

const KIND = Type.Union([
  Type.Literal('fact'),
  Type.Literal('instruction'),
  Type.Literal('event'),
  Type.Literal('task'),
])
const CONTENT = Type.String({ minLength: 1, maxLength: 2_000 })
const IMPORTANCE = Type.Optional(Type.Number({ minimum: 0, maximum: 1 }))
const OVERRIDES = Type.Optional(
  Type.String({
    minLength: 1,
    description: 'ID of a shared record this agent record replaces for the agent only',
  }),
)
const ENTRY = Type.Optional(
  Type.Integer({ minimum: 0, description: 'Entry ID; extraction cites its entries' }),
)

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function text(value: string) {
  return { output: [{ type: 'text' as const, text: value }] }
}

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

function describe(result: OperationResult & { replayed: boolean }): string {
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

/** The scope a job may write: the source agent's own scope, or the scope it consolidates. */
function jobScope(job: MemoryJob): Scope {
  switch (job.kind) {
    case 'remember':
    case 'extract':
    case 'record_archive':
      return `agent:${job.sourceAgentId}`
    case 'consolidate':
      return job.scope
    case 'apply_proposal':
      throw new Error('apply_proposal jobs run in code')
  }
}

function sourceAgentOf(job: MemoryJob, scope: Scope): string {
  if ('sourceAgentId' in job) return job.sourceAgentId
  return scope.slice(scope.indexOf(':') + 1)
}

interface RecordArgs {
  kind: RecordKind
  content: string
  importance?: number
  sourceEntryFrom?: number
  sourceEntryTo?: number
  overrides?: string
}

/** Build the record from the job, so origin, scope, and evidence never come from the model. */
function recordFor(job: MemoryJob, args: RecordArgs, now: number): NewRecord {
  const content = redactSecrets(args.content.trim())
  if (looksLikeInjection(content)) throw new Error('The content looks like an instruction to obey')
  const scope = jobScope(job)
  if (args.overrides !== undefined && !scope.startsWith('agent:')) {
    throw new Error('Only an agent record can override a shared record')
  }
  const base = {
    scope,
    kind: args.kind,
    content,
    sourceAgentId: sourceAgentOf(job, scope),
    importance: args.importance,
    ...(args.overrides === undefined ? {} : { overrides: args.overrides }),
    observedAt: now,
  }
  switch (job.kind) {
    case 'remember':
      return {
        ...base,
        origin: job.origin,
        importance: args.importance ?? (job.origin === 'user_request' ? 0.7 : 0.4),
        sourceEntries: job.sourceEntries,
      }
    case 'extract': {
      const from = args.sourceEntryFrom
      const to = args.sourceEntryTo ?? from
      if (from === undefined || to === undefined || from <= job.afterEntry || to < from) {
        throw new Error(`Cite the entries after ${job.afterEntry} that support the record`)
      }
      return { ...base, origin: 'extraction', sourceEntries: { from, to } }
    }
    case 'consolidate':
    case 'record_archive':
    case 'apply_proposal':
      return { ...base, origin: 'consolidation' }
  }
}

function writingTool<P extends TSchema>(
  deps: MemoryToolDeps,
  definition: {
    name: string
    description: string
    parameters: P
    operation: (args: Static<P>, job: MemoryJob, now: number) => Operation
    /** Side effects that must happen before the operation is recorded; they must be idempotent. */
    prepare?: (args: Static<P>, job: MemoryJob) => Promise<void>
  },
): ToolRegistration {
  return defineTool({
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    replay: 'safe',
    execute: async (args, api: ToolExecutionApi) => {
      const running = await deps.runningJob()
      if (running === undefined) throw new Error('No memory job is running')
      const now = deps.now?.() ?? Date.now()
      const op = definition.operation(args, running.job, now)
      const { job } = running
      if (job.kind === 'consolidate' && job.scope.startsWith('shared:') && op.type !== 'decline') {
        throw new Error('Shared records change only through reviewed proposals; use shared_propose')
      }
      await definition.prepare?.(args, running.job)
      const result = await applyOperation(
        memoryDb(deps.env.MEMORY_DB),
        {
          opId: await sha256(`${running.jobId}:${api.callId}`),
          jobId: running.jobId,
          runId: running.jobId,
          actor: 'memory-agent',
          now,
        },
        op,
      )
      return text(describe(result))
    },
  })
}

/** Scopes the memory agent searches for a job: its scope and the global shared space. */
function searchScopes(job: MemoryJob): Scope[] {
  const own = jobScope(job)
  return own === 'shared:global' ? [own] : [own, 'shared:global']
}

export function createMemoryAgentTools(deps: MemoryToolDeps): ToolRegistration[] {
  const db = (): MemoryDb => memoryDb(deps.env.MEMORY_DB)
  const search = defineTool({
    name: 'memory_search',
    description: 'Search active memory records related to the job; returns ids and revisions.',
    parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: 500 }) }),
    replay: 'safe',
    execute: async ({ query }) => {
      const running = await deps.runningJob()
      if (running === undefined) throw new Error('No memory job is running')
      const records = await searchMemory(db(), {
        query,
        scopes: searchScopes(running.job),
        now: deps.now?.() ?? Date.now(),
        countUse: false,
      })
      return text(formatRecords(records))
    },
  })

  const recordParameters = Type.Object({
    kind: KIND,
    content: CONTENT,
    importance: IMPORTANCE,
    sourceEntryFrom: ENTRY,
    sourceEntryTo: ENTRY,
    overrides: OVERRIDES,
  })
  const write = writingTool(deps, {
    name: 'memory_write',
    description: 'Write a new record for the job.',
    parameters: recordParameters,
    operation: (args, job, now) => ({ type: 'write', record: recordFor(job, args, now) }),
  })
  const supersede = writingTool(deps, {
    name: 'memory_supersede',
    description: 'Replace an active record, named by id and revision, with an updated one.',
    parameters: Type.Object({
      oldId: Type.String(),
      oldRevision: Type.Integer({ minimum: 1 }),
      kind: KIND,
      content: CONTENT,
      importance: IMPORTANCE,
      sourceEntryFrom: ENTRY,
      sourceEntryTo: ENTRY,
    }),
    operation: (args, job, now) => ({
      type: 'supersede',
      oldId: args.oldId,
      oldRevision: args.oldRevision,
      record: recordFor(job, args, now),
    }),
  })
  const invalidate = writingTool(deps, {
    name: 'memory_invalidate',
    description: 'Mark an active record as no longer true.',
    parameters: Type.Object({
      id: Type.String(),
      revision: Type.Integer({ minimum: 1 }),
      reason: Type.String({ minLength: 1, maxLength: 500 }),
    }),
    operation: (args) => ({
      type: 'invalidate',
      id: args.id,
      revision: args.revision,
      reason: args.reason,
    }),
  })
  const decline = writingTool(deps, {
    name: 'memory_decline',
    description: 'Decline the candidate of the job, with the reason.',
    parameters: Type.Object({ reason: Type.String({ minLength: 1, maxLength: 500 }) }),
    operation: (args, job) => ({
      type: 'decline',
      candidate: job.kind === 'remember' ? job.content : job.kind,
      reason: args.reason,
    }),
  })

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

  const listRecords = defineTool({
    name: 'list_records',
    description:
      'List the active records of the scope of a consolidate job, by kind and then most used first.',
    parameters: Type.Object({}),
    replay: 'safe',
    execute: async () => {
      const running = await deps.runningJob()
      if (running?.job.kind !== 'consolidate')
        throw new Error('list_records needs a consolidate job')
      const records = await consolidationRecords(db(), running.job.scope)
      const lines = records.map(
        (record) =>
          `- id=${record.id} revision=${record.revision} kind=${record.kind}` +
          ` importance=${record.importance} used=${record.useCount}` +
          ` observed=${new Date(record.observedAt).toISOString().slice(0, 10)}` +
          `${record.pinned ? ' pinned' : ''}${record.required ? ' required' : ''}` +
          `${record.overrides === null ? '' : ` overrides=${record.overrides}`}: ${record.content}`,
      )
      return text(lines.length === 0 ? 'No active records.' : lines.join('\n'))
    },
  })

  /** The agent scope a consolidate job may change skills in. */
  const skillScope = async (): Promise<{ jobId: string; scope: Scope }> => {
    const running = await deps.runningJob()
    if (running?.job.kind !== 'consolidate' || !running.job.scope.startsWith('agent:')) {
      throw new Error('Skills change only in a consolidate job of an agent scope')
    }
    return { jobId: running.jobId, scope: running.job.scope }
  }
  const skillRow = async (scope: Scope, name: string) =>
    db()
      .select()
      .from(skillsTable)
      .where(and(eq(skillsTable.scope, scope), eq(skillsTable.name, name)))
      .get()

  const listSkills = defineTool({
    name: 'list_skills',
    description:
      'List the skills of the agent scope of a consolidate job, with status and revision.',
    parameters: Type.Object({}),
    replay: 'safe',
    execute: async () => {
      const { scope } = await skillScope()
      const rows = await db().select().from(skillsTable).where(eq(skillsTable.scope, scope))
      const lines = rows.map(
        (row) =>
          `- ${row.name} status=${row.status} revision=${row.revision}` +
          `${row.basedOn === null ? '' : ` based_on=${row.basedOn}`}: ${row.description}`,
      )
      return text(lines.length === 0 ? 'No skills.' : lines.join('\n'))
    },
  })
  const readSkill = defineTool({
    name: 'read_skill',
    description: 'Read one file of a skill of the job scope; SKILL.md by default.',
    parameters: Type.Object({
      name: Type.String({ minLength: 1, maxLength: 64 }),
      path: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
    }),
    replay: 'safe',
    execute: async ({ name, path }) => {
      const { scope } = await skillScope()
      const object = await deps.env.ARCHIVE.get(`${skillDir(scope, name)}${path ?? 'SKILL.md'}`)
      if (object === null) throw new Error(`No file ${path ?? 'SKILL.md'} in skill ${name}`)
      return text(await object.text())
    },
  })
  const skillWrite = defineTool({
    name: 'skill_write',
    description:
      'Create or overwrite an agent skill: SKILL.md with name and description frontmatter, and files under references/, assets/, or scripts/. Pass the revision you read to update; omit it to create.',
    parameters: Type.Object({
      name: Type.String({ pattern: '^[a-z0-9-]{1,64}$' }),
      files: Type.Array(
        Type.Object({
          path: Type.String({ minLength: 1, maxLength: 300 }),
          content: Type.String({ maxLength: 200_000 }),
        }),
        { maxItems: 32 },
      ),
      remove: Type.Optional(
        Type.Array(Type.String({ minLength: 1, maxLength: 300 }), { maxItems: 32 }),
      ),
      revision: Type.Optional(Type.Integer({ minimum: 1 })),
      evidence: Type.String({
        minLength: 1,
        maxLength: 2_000,
        description:
          'The trajectories (entry ranges) where the procedure worked, and lessons from failures',
      }),
      basedOn: Type.Optional(
        Type.String({
          pattern: '^shared:[^/]+/[a-z0-9-]+@[0-9a-f]{64}$',
          description: 'For an override of a shared skill: shared:<space>/<name>@<content sha256>',
        }),
      ),
    }),
    replay: 'safe',
    execute: async (args, api: ToolExecutionApi) => {
      const { jobId, scope } = await skillScope()
      const files: Record<string, string | null> = {}
      for (const file of args.files) {
        const content = redactSecrets(file.content)
        if (looksLikeInjection(content))
          throw new Error(`${file.path} reads as instructions to obey`)
        files[file.path] = content
      }
      for (const path of args.remove ?? []) files[path] = null
      const now = deps.now?.() ?? Date.now()
      const result = await writeSkill(
        db(),
        deps.env.ARCHIVE,
        {
          opId: await sha256(`${jobId}:${api.callId}`),
          jobId,
          runId: jobId,
          actor: 'memory-agent',
          now,
        },
        {
          scope,
          name: args.name,
          files,
          baseRevision: args.revision,
          status: 'active',
          evidence: args.evidence,
          ...(args.basedOn === undefined ? {} : { basedOn: args.basedOn }),
        },
      )
      return text(describe(result))
    },
  })
  const skillArchive = defineTool({
    name: 'skill_archive',
    description:
      'Archive a skill of the job scope at the revision you read, or restore an archived one.',
    parameters: Type.Object({
      name: Type.String({ minLength: 1, maxLength: 64 }),
      revision: Type.Integer({ minimum: 1 }),
      restore: Type.Optional(Type.Boolean()),
    }),
    replay: 'safe',
    execute: async ({ name, revision, restore }, api: ToolExecutionApi) => {
      const { jobId, scope } = await skillScope()
      if ((await skillRow(scope, name)) === undefined) throw new Error(`No skill ${name}`)
      const result = await setSkillStatus(
        db(),
        {
          opId: await sha256(`${jobId}:${api.callId}`),
          jobId,
          runId: jobId,
          actor: 'memory-agent',
          now: deps.now?.() ?? Date.now(),
        },
        { scope, name, revision, status: restore === true ? 'active' : 'archived' },
      )
      return text(describe(result))
    },
  })

  const sharedPropose = defineTool({
    name: 'shared_propose',
    description:
      'Propose a change to a shared space for review: a record (new, or replacing a shared record by id) or an agent skill of the job scope to share. Cite the records or skills it rests on.',
    parameters: Type.Object({
      space: Type.String({ pattern: '^[a-z0-9-]{1,64}$' }),
      record: Type.Optional(
        Type.Object({
          kind: KIND,
          content: CONTENT,
          importance: IMPORTANCE,
          required: Type.Optional(
            Type.Boolean({ description: 'A team rule agents cannot override' }),
          ),
          replaces: Type.Optional(
            Type.String({ description: 'ID of the shared record it replaces' }),
          ),
        }),
      ),
      skill: Type.Optional(
        Type.String({ pattern: '^[a-z0-9-]{1,64}$', description: 'Agent skill name' }),
      ),
      sourceIds: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), {
        minItems: 1,
        maxItems: 20,
      }),
    }),
    replay: 'safe',
    execute: async (args, api: ToolExecutionApi) => {
      const running = await deps.runningJob()
      if (running?.job.kind !== 'consolidate')
        throw new Error('shared_propose needs a consolidate job')
      const { scope } = running.job
      if ((args.record === undefined) === (args.skill === undefined)) {
        throw new Error('Propose either a record or a skill')
      }
      const ctx = {
        opId: await sha256(`${running.jobId}:${api.callId}`),
        jobId: running.jobId,
        runId: running.jobId,
        actor: 'memory-agent',
        now: deps.now?.() ?? Date.now(),
      }
      if (args.record !== undefined) {
        const content = redactSecrets(args.record.content.trim())
        if (looksLikeInjection(content))
          throw new Error('The content looks like an instruction to obey')
        const proposal = await propose(db(), ctx, {
          space: args.space,
          payload: {
            type: 'record',
            kind: args.record.kind,
            content,
            ...(args.record.importance === undefined ? {} : { importance: args.record.importance }),
            ...(args.record.required === undefined ? {} : { required: args.record.required }),
            ...(args.record.replaces === undefined ? {} : { replaces: args.record.replaces }),
          },
          sourceIds: args.sourceIds,
        })
        return text(`proposed ${proposal.id} (pending review)`)
      }
      const name = args.skill ?? ''
      if (!scope.startsWith('agent:') || (await skillRow(scope, name)) === undefined) {
        throw new Error(`No agent skill ${name} in ${scope}`)
      }
      const files = await skillFilesAsBlobs(deps.env.ARCHIVE, scope, name)
      const proposal = await propose(db(), ctx, {
        space: args.space,
        payload: { type: 'skill', name, files, remove: [] },
        sourceIds: [
          `${scope}/${name}`,
          ...args.sourceIds.filter((id) => id !== `${scope}/${name}`),
        ],
      })
      return text(`proposed ${proposal.id} (pending review)`)
    },
  })

  return [
    sharedPropose,
    listRecords,
    listSkills,
    readSkill,
    skillWrite,
    skillArchive,
    search,
    write,
    supersede,
    invalidate,
    decline,
    readEntries,
    finishExtraction,
    readArchive,
    writeArchiveSummary,
  ]
}
