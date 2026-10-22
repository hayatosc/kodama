/**
 * The steps of a pruning run before the delete: prepare the range, export it to R2, and catalog it
 * in D1.
 *
 * @see docs/memory.md — Pruning
 *
 * @module
 */
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import { and, asc, eq, gt, lt } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/durable-sqlite'
import { pruneRuns } from '../../../drizzle/durable-object/schema.ts'
import type { LocalDb } from '../../storage/local.ts'
import { piEntries } from '../../storage/pi-tables.ts'
import { buildSegment, exportSegment, segmentId, segmentPrefix } from '../archive/segment.ts'
import { extractionCheckpoint, memoryDb } from '../store/db.ts'
import { archiveSegments } from '../../../drizzle/d1/schema.ts'
import type { PruneLimits, Run } from './runs.ts'
import type { PruneDeps } from './prune.ts'
import { prunedThrough, setState } from './runs.ts'

const context = BACKGROUND_CONTEXT

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

/**
 * Fix the next range: entries after the last pruned one and before the newest head, within the
 * run's byte budget.
 *
 * @returns The `prepared` run, or undefined when nothing is prunable.
 */
export async function prepare(
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

/** Write the run's segment to R2, verify it, and record `exported`. */
export async function exportRun(
  deps: PruneDeps,
  local: LocalDb,
  run: Run,
  now: number,
): Promise<Run> {
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

/**
 * Insert the segment's catalog row, read it back, record `indexed`, and queue its summary job.
 *
 * @throws When the catalog row cannot be read back.
 */
export async function catalog(
  deps: PruneDeps,
  local: LocalDb,
  run: Run,
  now: number,
): Promise<Run> {
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
      createdAt: now,
    })
    const stored = await db.select().from(archiveSegments).where(eq(archiveSegments.id, id)).get()
    if (stored === undefined) throw new Error(`Archive catalog row ${id} was not stored`)
  }
  const indexed = setState(local, run, { state: 'indexed' }, now)
  await enqueueQuietly(deps, { kind: 'record_archive', sourceAgentId: agentId, segmentId: id })
  return indexed
}
