/**
 * `history_search` over an agent's archived segments.
 *
 * @see docs/memory.md — Archive index
 *
 * @module
 */
import { and, desc, eq, lt, lte, or } from 'drizzle-orm'
import * as v from 'valibot'
import type { MemoryDb } from '../store/db.ts'
import { archiveSegments } from '../../../drizzle/d1/schema.ts'
import { searchWords } from '../../lib/search-text.ts'
import { entryText } from '../transcript.ts'
import { indexSchema, readJson, readSegment, summarySchema } from './reader.ts'
import type { SegmentIndex } from './segment.ts'

/** Bytes of index and summary objects one search reads, at most. */
export const HISTORY_READ_BUDGET_BYTES = 4 * 1024 * 1024
const HIT_TEXT_LIMIT = 4_000
const SEGMENTS_PER_SEARCH = 100

const positionNumber = v.pipe(v.number(), v.safeInteger(), v.minValue(0))
const cursorSchema = v.object({
  lastAt: positionNumber,
  lastEntry: positionNumber,
  nextEntry: v.optional(positionNumber),
  before: v.optional(positionNumber),
})
type Cursor = v.InferOutput<typeof cursorSchema>

function readCursor(value: string): Cursor {
  try {
    const parsed: unknown = JSON.parse(atob(value.replaceAll('-', '+').replaceAll('_', '/')))
    return v.parse(cursorSchema, parsed)
  } catch {
    throw new TypeError('Invalid history search cursor')
  }
}

function encodeCursor(cursor: Cursor): string {
  return btoa(JSON.stringify(cursor)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/** Chunks containing every word: merged words, then original segments, then prefixes. */
function matchChunks(index: SegmentIndex, query: string): number[] {
  const { merged, segments } = searchWords(query)
  const containing = (list: readonly string[], lookup: (word: string) => number[]) => {
    if (list.length === 0) return []
    const sets = list.map((word) => new Set(lookup(word)))
    const [firstSet, ...rest] = sets
    return [...(firstSet ?? [])].filter((chunk) => rest.every((set) => set.has(chunk)))
  }
  const exact = (word: string) =>
    Object.hasOwn(index.words, word) ? (index.words[word] ?? []) : []
  const prefix = (word: string) =>
    Object.entries(index.words).flatMap(([key, chunks]) => (key.startsWith(word) ? chunks : []))
  for (const attempt of [containing(merged, exact), containing(segments, exact)]) {
    if (attempt.length > 0) return attempt
  }
  return containing(merged, prefix)
}

function summaryMatches(words: readonly string[], query: string): boolean {
  const set = new Set(words)
  const { merged } = searchWords(query)
  return (
    merged.length > 0 &&
    merged.every((word) => set.has(word) || words.some((w) => w.startsWith(word)))
  )
}

/** A matching chunk of archived text. */
export interface HistoryHit {
  firstEntry: number
  lastEntry: number
  at: number
  text: string
}

/** What one search found, and how far back it looked. */
export interface HistoryResult {
  hits: HistoryHit[]
  summaries: { segmentId: string; at: number; summary: string }[]
  /** The oldest time visited, for display; equal timestamps require `nextCursor` to resume. */
  searchedBefore: number | undefined
  /** Opaque continuation for the same query; includes the original time bound. */
  nextCursor: string | undefined
  /** Every eligible archived range of the agent was searched. */
  complete: boolean
}

/**
 * Search an agent's archived entries, newest first, within the read budget.
 *
 * @returns The matches and a continuation cursor when eligible history remains.
 * @throws {@link TypeError} When the cursor is invalid or its time bound is changed.
 */
export async function searchHistory(
  db: MemoryDb,
  bucket: R2Bucket,
  agentId: string,
  query: string,
  options: { before?: number; cursor?: string; limit?: number; budgetBytes?: number } = {},
): Promise<HistoryResult> {
  const limit = options.limit ?? 5
  const budget = options.budgetBytes ?? HISTORY_READ_BUDGET_BYTES
  const cursor = options.cursor === undefined ? undefined : readCursor(options.cursor)
  if (cursor !== undefined && options.before !== undefined && options.before !== cursor.before) {
    throw new TypeError('A history search cursor keeps its original before bound')
  }
  const before = cursor === undefined ? options.before : cursor.before
  const segments = await db
    .select()
    .from(archiveSegments)
    .where(
      and(
        eq(archiveSegments.agentId, agentId),
        // Include a segment overlapping the time bound; filter its chunks below.
        before === undefined ? undefined : lt(archiveSegments.firstAt, before),
        cursor === undefined
          ? undefined
          : or(
              lt(archiveSegments.lastAt, cursor.lastAt),
              and(
                eq(archiveSegments.lastAt, cursor.lastAt),
                lte(archiveSegments.lastEntry, cursor.lastEntry),
              ),
            ),
      ),
    )
    .orderBy(desc(archiveSegments.lastAt), desc(archiveSegments.lastEntry))
    // One lookahead row distinguishes an exhausted catalog from a full page.
    .limit(SEGMENTS_PER_SEARCH + 1)
  const result: HistoryResult = {
    hits: [],
    summaries: [],
    searchedBefore: undefined,
    nextCursor: undefined,
    complete: true,
  }
  const pause = (segment: (typeof segments)[number], nextEntry?: number): HistoryResult => ({
    ...result,
    complete: false,
    nextCursor: encodeCursor({
      lastAt: segment.lastAt,
      lastEntry: segment.lastEntry,
      nextEntry,
      before,
    }),
  })
  let read = 0
  for (const [position, segment] of segments.entries()) {
    const nextEntry =
      cursor?.lastEntry === segment.lastEntry && cursor.lastAt === segment.lastAt
        ? cursor.nextEntry
        : undefined
    if (position === SEGMENTS_PER_SEARCH || read >= budget || result.hits.length >= limit) {
      return pause(segment, nextEntry)
    }
    // A resumed segment already contributed its summary; a bounded search must not show newer text.
    if (
      segment.hasSummary &&
      nextEntry === undefined &&
      (before === undefined || segment.lastAt < before)
    ) {
      const summary = await readJson(bucket, `${segment.r2Prefix}.summary.json`, summarySchema)
      if (summary !== undefined) {
        read += summary.bytes
        if (summaryMatches(summary.value.words, query)) {
          result.summaries.push({
            segmentId: segment.id,
            at: segment.lastAt,
            summary: summary.value.summary,
          })
        }
      }
    }
    const index = await readJson(bucket, `${segment.r2Prefix}.index.json`, indexSchema)
    if (index === undefined) {
      result.searchedBefore = segment.firstAt
      continue
    }
    read += index.bytes
    const chunks = matchChunks(index.value, query)
      .map((chunkIndex) => index.value.chunks[chunkIndex])
      .filter((chunk) => chunk !== undefined)
      .filter((chunk) => before === undefined || chunk.at < before)
      .filter((chunk) => nextEntry === undefined || chunk.first <= nextEntry)
      .sort((a, b) => b.first - a.first)
    for (const chunk of chunks) {
      if (result.hits.length >= limit) return pause(segment, chunk.first)
      const entries = await readSegment(bucket, segment.r2Prefix, chunk)
      const text = entries
        .flatMap(({ entry }) => {
          const line = entry === undefined ? undefined : entryText(entry)
          return line === undefined ? [] : [`#${line.id} ${line.role}: ${line.text}`]
        })
        .join('\n')
        .slice(0, HIT_TEXT_LIMIT)
      result.hits.push({ firstEntry: chunk.first, lastEntry: chunk.last, at: chunk.at, text })
      result.searchedBefore = chunk.at
    }
    result.searchedBefore = segment.firstAt
  }
  return result
}
