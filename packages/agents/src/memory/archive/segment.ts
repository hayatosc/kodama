/**
 * Archived ranges of entries in R2: building and exporting a segment, its search index, and its
 * summary (docs/design/long-term-memory.md, Pruning, Archive index).
 */
import type { EntryRecord } from '@earendil-works/pi-durable'
import { SEARCH_VERSION, storedSearchText } from '../store/search-text.ts'
import { entryText } from '../transcript.ts'

export const ARCHIVE_FORMAT = 1
/** Pi Durable version whose entry records the archive holds. */
export const PI_DURABLE_VERSION = '1.2.0'
export const CHUNK_CHARS = 2_000

/** A Pi `entries` row: its ID and the record JSON exactly as stored. */
export interface EntryRow {
  id: number
  record: string
}

export interface Chunk {
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
export function isEntryRecord(value: unknown): value is EntryRecord {
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

/** The summary of a segment, written by the memory agent's `record_archive` job. */
export async function writeSummary(
  bucket: R2Bucket,
  prefix: string,
  summary: string,
): Promise<void> {
  const words = [...new Set(storedSearchText(summary).split(' '))].filter((word) => word.length > 0)
  await bucket.put(`${prefix}.summary.json`, JSON.stringify({ summary, words }))
}
