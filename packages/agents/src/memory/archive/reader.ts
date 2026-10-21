/** Reading archived segments back from R2: entries, byte ranges, and index files (Archive index). */
import * as v from 'valibot'
import { entryText } from '../transcript.ts'
import type { EntryText } from '../transcript.ts'
import { isEntryRecord } from './segment.ts'
import type { Chunk } from './segment.ts'
import type { EntryRecord } from '@earendil-works/pi-durable'

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

export const indexSchema = v.object({
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
export const summarySchema = v.object({ summary: v.string(), words: v.array(v.string()) })

export async function readJson<T>(
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
