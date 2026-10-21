/**
 * Archived ranges of entries in R2, their search index, and `history_search`
 * (docs/design/long-term-memory.md, Pruning, Archive index).
 */
import type { EntryRecord } from '@earendil-works/pi-durable'
import { and, desc, eq, lt } from 'drizzle-orm'
import * as v from 'valibot'
import type { MemoryDb } from './records.ts'
import { archiveSegments } from './schema.ts'
import { SEARCH_VERSION, searchWords, storedSearchText } from './search-text.ts'
import { entryText } from './transcript.ts'
import type { EntryText } from './transcript.ts'

export const ARCHIVE_FORMAT = 1
/** Pi Durable version whose entry records the archive holds. */
export const PI_DURABLE_VERSION = '1.2.0'
export const CHUNK_CHARS = 2_000
export const HISTORY_READ_BUDGET_BYTES = 4 * 1024 * 1024
const HIT_TEXT_LIMIT = 4_000

/** A Pi `entries` row: its ID and the record JSON exactly as stored. */
export interface EntryRow {
  id: number
  record: string
}

interface Chunk {
  first: number
  last: number
  /** Byte range in the `.jsonl` object. */
  start: number
  end: number
  at: number
}

export interface SegmentIndex {
  format: number
  searchVersion: number
  chunks: Chunk[]
  /** Normalized word to the chunks that contain it. */
  words: Record<string, number[]>
}

export interface SegmentManifest {
  format: number
  agentId: string
  firstEntry: number
  lastEntry: number
  entryCount: number
  firstAt: number
  lastAt: number
  sha256: string
  bytes: number
  piDurable: string
}

export interface SegmentFiles {
  jsonl: string
  manifest: SegmentManifest
  index: SegmentIndex
}

export function segmentId(agentId: string, first: number, last: number): string {
  return `${agentId}/${first}-${last}`
}

export function segmentPrefix(agentId: string, first: number, last: number): string {
  return `archive/${segmentId(agentId, first, last)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Narrow a parsed record to the fields entryText reads. */
function isEntryRecord(value: unknown): value is EntryRecord {
  return isRecord(value) && typeof value['kind'] === 'string'
}

function parseEntry(json: string): EntryRecord | undefined {
  const value: unknown = JSON.parse(json)
  return isEntryRecord(value) ? value : undefined
}

/** The first message timestamp of an entry, if any. */
function entryTime(entry: EntryRecord | undefined): number | undefined {
  for (const message of entry?.model ?? []) {
    const value: unknown = message
    if (isRecord(value) && typeof value['timestamp'] === 'number') return value['timestamp']
  }
  return undefined
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** The `.jsonl`, manifest, and search index of one range of entries, built in code. */
export async function buildSegment(
  agentId: string,
  rows: readonly EntryRow[],
  now: number,
): Promise<SegmentFiles> {
  const first = rows[0]
  const last = rows.at(-1)
  if (first === undefined || last === undefined) throw new Error('A segment needs entries')
  const encoder = new TextEncoder()
  const lines: string[] = []
  const chunks: Chunk[] = []
  const words: Record<string, number[]> = {}
  let offset = 0
  let firstAt: number | undefined
  let lastAt: number | undefined
  let pending:
    | { first: number; last: number; start: number; end: number; at: number; text: string[] }
    | undefined

  const flush = () => {
    if (pending === undefined) return
    const index = chunks.length
    chunks.push({
      first: pending.first,
      last: pending.last,
      start: pending.start,
      end: pending.end,
      at: pending.at,
    })
    for (const word of new Set(storedSearchText(pending.text.join('\n')).split(' '))) {
      if (word.length === 0) continue
      ;(words[word] ??= []).push(index)
    }
    pending = undefined
  }

  for (const row of rows) {
    const line = `{"id":${row.id},"record":${row.record}}\n`
    const start = offset
    offset += encoder.encode(line).byteLength
    lines.push(line)
    const entry = parseEntry(row.record)
    const at = entryTime(entry) ?? lastAt ?? now
    firstAt ??= at
    lastAt = at
    const text = entry === undefined ? undefined : entryText(entry)
    if (text === undefined) continue
    pending ??= { first: row.id, last: row.id, start, end: offset, at, text: [] }
    pending.last = row.id
    pending.end = offset
    pending.text.push(`${text.role}: ${text.text}`)
    if (pending.text.join('\n').length >= CHUNK_CHARS) flush()
  }
  flush()

  const jsonl = lines.join('')
  const bytes = encoder.encode(jsonl)
  const manifest: SegmentManifest = {
    format: ARCHIVE_FORMAT,
    agentId,
    firstEntry: first.id,
    lastEntry: last.id,
    entryCount: rows.length,
    firstAt: firstAt ?? now,
    lastAt: lastAt ?? now,
    sha256: await sha256Hex(bytes),
    bytes: bytes.byteLength,
    piDurable: PI_DURABLE_VERSION,
  }
  return {
    jsonl,
    manifest,
    index: { format: ARCHIVE_FORMAT, searchVersion: SEARCH_VERSION, chunks, words },
  }
}

/** Write the segment's objects and read them back; throws unless all three are intact. */
export async function exportSegment(
  bucket: R2Bucket,
  prefix: string,
  files: SegmentFiles,
): Promise<void> {
  await bucket.put(`${prefix}.jsonl`, files.jsonl, { sha256: files.manifest.sha256 })
  await bucket.put(`${prefix}.index.json`, JSON.stringify(files.index))
  await bucket.put(`${prefix}.manifest.json`, JSON.stringify(files.manifest))
  const stored = await bucket.head(`${prefix}.jsonl`)
  const index = await bucket.head(`${prefix}.index.json`)
  const manifest = await bucket.head(`${prefix}.manifest.json`)
  if (stored?.size !== files.manifest.bytes || index === null || manifest === null) {
    throw new Error(`Archive export of ${prefix} could not be verified`)
  }
}

export interface ArchivedEntry {
  id: number
  entry: EntryRecord | undefined
}

const lineSchema = v.object({ id: v.number(), record: v.unknown() })

function parseLines(text: string): ArchivedEntry[] {
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const { id, record } = v.parse(lineSchema, JSON.parse(line))
      return { id, entry: isEntryRecord(record) ? record : undefined }
    })
}

/** Entries of a segment, optionally only a byte range of its `.jsonl` object. */
export async function readSegment(
  bucket: R2Bucket,
  prefix: string,
  range?: { start: number; end: number },
): Promise<ArchivedEntry[]> {
  const object = await bucket.get(
    `${prefix}.jsonl`,
    range === undefined
      ? undefined
      : { range: { offset: range.start, length: range.end - range.start } },
  )
  if (object === null) throw new Error(`Archived entries ${prefix} are missing`)
  return parseLines(await object.text())
}

const indexSchema = v.object({
  format: v.number(),
  searchVersion: v.number(),
  chunks: v.array(
    v.object({
      first: v.number(),
      last: v.number(),
      start: v.number(),
      end: v.number(),
      at: v.number(),
    }),
  ),
  words: v.record(v.string(), v.array(v.number())),
})
const summarySchema = v.object({ summary: v.string(), words: v.array(v.string()) })

async function readJson<T>(
  bucket: R2Bucket,
  key: string,
  schema: v.GenericSchema<unknown, T>,
): Promise<{ value: T; bytes: number } | undefined> {
  const object = await bucket.get(key)
  if (object === null) return undefined
  const text = await object.text()
  const parsed: unknown = JSON.parse(text)
  return { value: v.parse(schema, parsed), bytes: text.length }
}

/**
 * Text entries of a segment after entry `after`, read through the index so only the byte ranges of
 * about `limit` entries are fetched. `through` is the last entry returned, or undefined once the
 * segment has no text left after `after`.
 */
export async function readArchivedText(
  bucket: R2Bucket,
  prefix: string,
  after: number,
  limit: number,
): Promise<{ entries: EntryText[]; through: number | undefined }> {
  const index = await readJson(bucket, `${prefix}.index.json`, indexSchema)
  if (index === undefined) throw new Error(`Archive index ${prefix} is missing`)
  const chunks: Chunk[] = []
  let covered = 0
  for (const chunk of index.value.chunks) {
    if (chunk.last <= after) continue
    chunks.push(chunk)
    covered += chunk.last - Math.max(chunk.first, after + 1) + 1
    if (covered >= limit) break
  }
  const first = chunks[0]
  const last = chunks.at(-1)
  if (first === undefined || last === undefined) return { entries: [], through: undefined }
  const entries = (await readSegment(bucket, prefix, { start: first.start, end: last.end }))
    .filter((entry) => entry.id > after)
    .flatMap(({ entry }) => (entry === undefined ? [] : (entryText(entry) ?? [])))
    .slice(0, limit)
  return { entries, through: entries.at(-1)?.id ?? last.last }
}

/** The summary of a segment, written by the memory agent's `record_archive` job. */
export async function writeSummary(
  bucket: R2Bucket,
  prefix: string,
  summary: string,
): Promise<void> {
  const words = [...new Set(storedSearchText(summary).split(' '))].filter((word) => word.length > 0)
  await bucket.put(`${prefix}.summary.json`, JSON.stringify({ summary, words }))
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
