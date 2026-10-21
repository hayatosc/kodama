/**
 * Pruning: archive old Pi entries to R2 and delete them from the Durable Object, as a resumable
 * state machine (docs/design/long-term-memory.md, Pruning).
 */
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import type { Harness } from '@earendil-works/pi-durable'
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  lt,
  max,
  ne,
  notInArray,
} from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/durable-sqlite'
import * as v from 'valibot'
import type { AgentEnv } from '../env.ts'
import { pruneRuns } from '../storage/local-schema.ts'
import type { LocalDb } from '../storage/local.ts'
import {
  piConversations,
  piDocumentRevisions,
  piDocuments,
  piEntries,
  piRecordIds,
  piTasks,
} from '../storage/pi-tables.ts'
import { buildSegment, exportSegment, segmentId, segmentPrefix } from './archive.ts'
import { extractionCheckpoint, memoryDb } from './records.ts'
import { archiveSegments } from './schema.ts'

const context = BACKGROUND_CONTEXT
const GIB = 1024 * 1024 * 1024
const MIB = 1024 * 1024

export interface PruneLimits {
  /** Prune once the database is larger than this. */
  thresholdBytes: number
  /** Reject new input above this until a run deletes rows. */
  hardBytes: number
  /** Entries per run, measured as stored record bytes. */
  runBytes: number
}

export const DEFAULT_PRUNE_LIMITS: PruneLimits = {
  thresholdBytes: GIB,
  hardBytes: 8 * GIB,
  runBytes: 16 * MIB,
}

/** An operator can lower the limits of one object by storing this key. */
export const PRUNE_LIMITS_KEY = 'kodama:prune-limits'
const limitsSchema = v.partial(
  v.object({
    thresholdBytes: v.pipe(v.number(), v.minValue(0)),
    hardBytes: v.pipe(v.number(), v.minValue(0)),
    runBytes: v.pipe(v.number(), v.minValue(1)),
  }),
)

/** Retry a delete whose checks failed after this long. */
export const PRUNE_RETRY_MS = 10 * 60_000

export async function pruneLimits(storage: DurableObjectStorage): Promise<PruneLimits> {
  const stored = v.safeParse(limitsSchema, await storage.get(PRUNE_LIMITS_KEY))
  return { ...DEFAULT_PRUNE_LIMITS, ...(stored.success ? stored.output : {}) }
}

export type PruneOutcome = 'nothing' | 'deferred' | 'pruned'

export interface PruneDeps {
  storage: DurableObjectStorage
  env: Pick<AgentEnv, 'MEMORY_DB' | 'ARCHIVE' | 'MEMORY_AGENT'>
  agentId: () => string
  local: () => Promise<LocalDb>
  harness: () => Promise<Harness>
  /**
   * In one exclusive section: run `check` against the open harness and, if it passes, close the
   * harness, run `mutate` in one storage transaction, and open it again.
   */
  exclusive: (check: (harness: Harness) => Promise<boolean>, mutate: () => void) => Promise<boolean>
  /** Archive the entries before deleting them; the memory agent only deletes. */
  archive: boolean
  memoryAgent: () => { enqueue(job: unknown): Promise<unknown> }
  /** Test hook that runs after each state is recorded. */
  afterState?: (state: string) => Promise<void>
  now?: () => number
}

type Run = typeof pruneRuns.$inferSelect

/** The last entry pruned so far, or 0. */
export function prunedThrough(local: LocalDb): number {
  const row = local
    .select({ last: max(pruneRuns.lastEntry) })
    .from(pruneRuns)
    .where(eq(pruneRuns.state, 'deleted'))
    .get()
  return row?.last ?? 0
}

export function unfinishedRun(local: LocalDb): Run | undefined {
  return local
    .select()
    .from(pruneRuns)
    .where(ne(pruneRuns.state, 'deleted'))
    .orderBy(desc(pruneRuns.id))
    .get()
}

/** The newest compaction or reset head of the root conversation, read without the harness. */
function latestHead(storage: DurableObjectStorage): number | undefined {
  const row = drizzle(storage)
    .select({ head: piEntries.head })
    .from(piEntries)
    .where(and(eq(piEntries.conversationId, ROOT_CONVERSATION_ID), isNotNull(piEntries.head)))
    .orderBy(desc(piEntries.id))
    .limit(1)
    .get()
  return row?.head ?? undefined
}

/**
 * A run is unfinished, or the database is over the threshold and entries before the newest head
 * remain. Reads storage only, so it is safe while the harness opens.
 */
export async function needsPrune(storage: DurableObjectStorage, local: LocalDb): Promise<boolean> {
  if (unfinishedRun(local) !== undefined) return true
  const limits = await pruneLimits(storage)
  if (storage.sql.databaseSize <= limits.thresholdBytes) return false
  const head = latestHead(storage)
  if (head === undefined) return false
  const candidate = drizzle(storage)
    .select({ id: piEntries.id })
    .from(piEntries)
    .where(
      and(
        eq(piEntries.conversationId, ROOT_CONVERSATION_ID),
        gt(piEntries.id, prunedThrough(local)),
        lt(piEntries.id, head),
      ),
    )
    .limit(1)
    .get()
  return candidate !== undefined
}

/** Memory is an aid: a failing job enqueue is logged and pruning goes on. */
async function enqueueQuietly(deps: PruneDeps, job: unknown): Promise<void> {
  try {
    await deps.memoryAgent().enqueue(job)
  } catch (error) {
    console.error('Memory job enqueue failed during pruning', error)
  }
}

const MEASURE_PAGE = 200

/**
 * The entries after `after` and before `head` whose records fit `runBytes` (at least one), read a
 * page at a time so only about one run's records are in memory.
 */
function measureRange(
  storage: DurableObjectStorage,
  after: number,
  head: number,
  runBytes: number,
): { first: number; last: number } | undefined {
  const pi = drizzle(storage)
  const encoder = new TextEncoder()
  let first: number | undefined
  let last = after
  let bytes = 0
  for (;;) {
    const page = pi
      .select({ id: piEntries.id, record: piEntries.record })
      .from(piEntries)
      .where(
        and(
          eq(piEntries.conversationId, ROOT_CONVERSATION_ID),
          gt(piEntries.id, last),
          lt(piEntries.id, head),
        ),
      )
      .orderBy(asc(piEntries.id))
      .limit(MEASURE_PAGE)
      .all()
    for (const row of page) {
      const size = encoder.encode(row.record).byteLength
      if (first !== undefined && bytes + size > runBytes) return { first, last }
      first ??= row.id
      bytes += size
      last = row.id
    }
    if (page.length < MEASURE_PAGE) return first === undefined ? undefined : { first, last }
  }
}

/** Fix the next range: entries after the last pruned one, before the newest head, within runBytes. */
async function prepare(
  deps: PruneDeps,
  local: LocalDb,
  limits: PruneLimits,
): Promise<Run | undefined> {
  const harness = await deps.harness()
  const marker = await harness.commit((tx) => tx.latestHeadMarker(ROOT_CONVERSATION_ID), context)
  if (marker === undefined) return undefined
  const head = marker.head
  const after = prunedThrough(local)
  const range = measureRange(deps.storage, after, head, limits.runBytes)
  if (range === undefined) return undefined
  const { first, last } = range
  const now = deps.now?.() ?? Date.now()
  const run = local
    .insert(pruneRuns)
    .values({
      firstEntry: first,
      lastEntry: last,
      head,
      state: 'prepared',
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()
  if (deps.archive) {
    const checkpoint = await extractionCheckpoint(memoryDb(deps.env.MEMORY_DB), deps.agentId())
    if (checkpoint < last) {
      await enqueueQuietly(deps, {
        kind: 'extract',
        sourceAgentId: deps.agentId(),
        afterEntry: checkpoint,
      })
    }
  }
  return run
}

function setState(
  local: LocalDb,
  run: Run,
  change: Partial<Run> & { state: Run['state'] },
  now: number,
): Run {
  return local
    .update(pruneRuns)
    .set({ ...change, updatedAt: now })
    .where(eq(pruneRuns.id, run.id))
    .returning()
    .get()
}

async function exportRun(deps: PruneDeps, local: LocalDb, run: Run, now: number): Promise<Run> {
  if (!deps.archive) return setState(local, run, { state: 'indexed' }, now)
  const rows = drizzle(deps.storage)
    .select({ id: piEntries.id, record: piEntries.record })
    .from(piEntries)
    .where(
      and(
        eq(piEntries.conversationId, ROOT_CONVERSATION_ID),
        gt(piEntries.id, run.firstEntry - 1),
        lt(piEntries.id, run.lastEntry + 1),
      ),
    )
    .orderBy(asc(piEntries.id))
    .all()
  const agentId = deps.agentId()
  const files = await buildSegment(agentId, rows, now)
  await exportSegment(
    deps.env.ARCHIVE,
    segmentPrefix(agentId, run.firstEntry, run.lastEntry),
    files,
  )
  return setState(
    local,
    run,
    {
      state: 'exported',
      entryCount: files.manifest.entryCount,
      bytes: files.manifest.bytes,
      sha256: files.manifest.sha256,
      firstAt: files.manifest.firstAt,
      lastAt: files.manifest.lastAt,
    },
    now,
  )
}

async function catalog(deps: PruneDeps, local: LocalDb, run: Run, now: number): Promise<Run> {
  const agentId = deps.agentId()
  const id = segmentId(agentId, run.firstEntry, run.lastEntry)
  const db = memoryDb(deps.env.MEMORY_DB)
  const existing = await db.select().from(archiveSegments).where(eq(archiveSegments.id, id)).get()
  if (existing === undefined) {
    await db.insert(archiveSegments).values({
      id,
      agentId,
      firstEntry: run.firstEntry,
      lastEntry: run.lastEntry,
      entryCount: run.entryCount ?? 0,
      r2Prefix: segmentPrefix(agentId, run.firstEntry, run.lastEntry),
      sha256: run.sha256 ?? '',
      bytes: run.bytes ?? 0,
      firstAt: run.firstAt ?? now,
      lastAt: run.lastAt ?? now,
      extracted: (await extractionCheckpoint(db, agentId)) >= run.lastEntry,
      createdAt: now,
    })
    const stored = await db.select().from(archiveSegments).where(eq(archiveSegments.id, id)).get()
    if (stored === undefined) throw new Error(`Archive catalog row ${id} was not stored`)
  }
  const indexed = setState(local, run, { state: 'indexed' }, now)
  await enqueueQuietly(deps, { kind: 'record_archive', sourceAgentId: agentId, segmentId: id })
  return indexed
}

/** Delete the run's entries, terminal tasks with their documents, and their ID records. */
function deleteRows(storage: DurableObjectStorage, local: LocalDb, run: Run, now: number): void {
  const pi = drizzle(storage)
  pi.delete(piEntries)
    .where(
      and(
        eq(piEntries.conversationId, ROOT_CONVERSATION_ID),
        gt(piEntries.id, run.firstEntry - 1),
        lt(piEntries.id, run.lastEntry + 1),
      ),
    )
    .run()
  const terminalTasks = pi
    .select({ id: piTasks.id })
    .from(piTasks)
    .where(eq(piTasks.status, 'terminal'))
  const taskDocuments = pi
    .select({ id: piDocuments.id })
    .from(piDocuments)
    .where(and(eq(piDocuments.scopeKind, 'task'), inArray(piDocuments.ownerId, terminalTasks)))
  pi.delete(piDocumentRevisions).where(inArray(piDocumentRevisions.documentId, taskDocuments)).run()
  pi.delete(piDocuments)
    .where(and(eq(piDocuments.scopeKind, 'task'), inArray(piDocuments.ownerId, terminalTasks)))
    .run()
  pi.delete(piTasks).where(eq(piTasks.status, 'terminal')).run()
  pi.delete(piRecordIds)
    .where(
      and(
        eq(piRecordIds.recordType, 'entry'),
        gt(piRecordIds.id, run.firstEntry - 1),
        lt(piRecordIds.id, run.lastEntry + 1),
      ),
    )
    .run()
  pi.delete(piRecordIds)
    .where(
      and(
        eq(piRecordIds.recordType, 'task'),
        notInArray(piRecordIds.id, pi.select({ id: piTasks.id }).from(piTasks)),
      ),
    )
    .run()
  pi.delete(piRecordIds)
    .where(
      and(
        eq(piRecordIds.recordType, 'document'),
        notInArray(piRecordIds.id, pi.select({ id: piDocuments.id }).from(piDocuments)),
      ),
    )
    .run()
  setState(local, run, { state: 'deleted' }, now)
}

/** Nothing may still read the run's entries: no live task, no queued input, one conversation. */
async function safeToDelete(
  storage: DurableObjectStorage,
  harness: Harness,
  run: Run,
): Promise<boolean> {
  const { tasks, submissions } = await harness.inspect(context)
  if (tasks.length > 0 || submissions.length > 0) return false
  const conversations = drizzle(storage).select({ n: count() }).from(piConversations).get()
  if (conversations?.n !== 1) return false
  const marker = await harness.commit((tx) => tx.latestHeadMarker(ROOT_CONVERSATION_ID), context)
  return marker !== undefined && marker.head >= run.head
}

/**
 * Take the unfinished run, or prepare a new one, one state further each step until its rows are
 * deleted. `deferred` means the delete checks failed; retry after PRUNE_RETRY_MS.
 */
export async function pruneOnce(
  deps: PruneDeps,
  options: { force?: boolean } = {},
): Promise<PruneOutcome> {
  const local = await deps.local()
  const limits = await pruneLimits(deps.storage)
  let run = unfinishedRun(local)
  if (run === undefined) {
    if (!options.force && deps.storage.sql.databaseSize <= limits.thresholdBytes) return 'nothing'
    run = await prepare(deps, local, limits)
    if (run === undefined) return 'nothing'
    await deps.afterState?.(run.state)
  }
  const now = () => deps.now?.() ?? Date.now()
  if (run.state === 'prepared') {
    run = await exportRun(deps, local, run, now())
    await deps.afterState?.(run.state)
  }
  if (run.state === 'exported') {
    run = await catalog(deps, local, run, now())
    await deps.afterState?.(run.state)
  }
  const current = run
  const deleted = await deps.exclusive(
    (harness) => safeToDelete(deps.storage, harness, current),
    () => deleteRows(deps.storage, local, current, now()),
  )
  if (!deleted) return 'deferred'
  await deps.afterState?.('deleted')
  return 'pruned'
}
