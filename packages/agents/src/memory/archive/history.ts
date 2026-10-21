/** `history_search` over an agent's archived segments (docs/design/long-term-memory.md, Archive index). */
import { and, desc, eq, lt } from 'drizzle-orm'
import type { MemoryDb } from '../store/db.ts'
import { archiveSegments } from '../store/schema/archive.ts'
import { searchWords } from '../store/search-text.ts'
import { entryText } from '../transcript.ts'
import { indexSchema, readJson, readSegment, summarySchema } from './reader.ts'
import type { SegmentIndex } from './segment.ts'

export const HISTORY_READ_BUDGET_BYTES = 4 * 1024 * 1024
const HIT_TEXT_LIMIT = 4_000

/** Chunks containing every word: merged words, then original segments, then prefixes. */
function matchChunks(index: SegmentIndex, query: string): number[] {
  const { merged, segments } = searchWords(query)
  const containing = (list: readonly string[], lookup: (word: string) => number[]) => {
    if (list.length === 0) return []
    const sets = list.map((word) => new Set(lookup(word)))
    const [firstSet, ...rest] = sets
    return [...(firstSet ?? [])].filter((chunk) => rest.every((set) => set.has(chunk)))
  }
  const exact = (word: string) => index.words[word] ?? []
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

export interface HistoryHit {
  firstEntry: number
  lastEntry: number
  at: number
  text: string
}

export interface HistoryResult {
  hits: HistoryHit[]
  summaries: { segmentId: string; at: number; summary: string }[]
  /** The oldest time searched; pass it as `before` to search further back. */
  searchedBefore: number | undefined
  /** Every archived range of the agent was searched. */
  complete: boolean
}

/** Search an agent's archived entries newest first, reading at most the byte budget of indexes. */
export async function searchHistory(
  db: MemoryDb,
  bucket: R2Bucket,
  agentId: string,
  query: string,
  options: { before?: number; limit?: number; budgetBytes?: number } = {},
): Promise<HistoryResult> {
  const limit = options.limit ?? 5
  const budget = options.budgetBytes ?? HISTORY_READ_BUDGET_BYTES
  const segments = await db
    .select()
    .from(archiveSegments)
    .where(
      and(
        eq(archiveSegments.agentId, agentId),
        options.before === undefined ? undefined : lt(archiveSegments.lastAt, options.before),
      ),
    )
    .orderBy(desc(archiveSegments.lastAt))
    .limit(100)
  const result: HistoryResult = {
    hits: [],
    summaries: [],
    searchedBefore: undefined,
    complete: segments.length < 100,
  }
  let read = 0
  for (const segment of segments) {
    if (read >= budget || result.hits.length >= limit) {
      result.complete = false
      break
    }
    result.searchedBefore = segment.firstAt
    if (segment.hasSummary) {
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
    if (index === undefined) continue
    read += index.bytes
    for (const chunkIndex of matchChunks(index.value, query).reverse()) {
      const chunk = index.value.chunks[chunkIndex]
      if (chunk === undefined || result.hits.length >= limit) continue
      const entries = await readSegment(bucket, segment.r2Prefix, chunk)
      const text = entries
        .flatMap(({ entry }) => {
          const line = entry === undefined ? undefined : entryText(entry)
          return line === undefined ? [] : [`#${line.id} ${line.role}: ${line.text}`]
        })
        .join('\n')
        .slice(0, HIT_TEXT_LIMIT)
      result.hits.push({ firstEntry: chunk.first, lastEntry: chunk.last, at: chunk.at, text })
    }
  }
  return result
}
