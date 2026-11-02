/**
 * Reading archived segments back from R2: entries, byte ranges, and index files.
 *
 * @see docs/memory.md — Archive index
 *
 * @module
 */
import * as v from 'valibot'
import { entryText } from '../transcript.ts'
import type { EntryText } from '../transcript.ts'
import { isEntryRecord } from './segment.ts'
import type { Chunk } from './segment.ts'
import type { EntryRecord } from '@earendil-works/pi-durable'

/** One archived entry: its ID and the record JSON as Pi stored it. */
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

/**
 * A segment's entries, or only those in a byte range of its `.jsonl` object.
 *
 * @throws When the segment's entries are missing from R2.
 */
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

// Validate entries instead of using v.record, which drops words such as `constructor`.
// Object.fromEntries defines own properties even for `__proto__`, preserving format-one indexes.
const wordIndexSchema = v.pipe(
  v.custom<Record<string, unknown>>(
    (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  ),
  v.transform((words) => Object.entries(words)),
  v.array(v.tuple([v.string(), v.array(v.number())])),
  v.transform((entries) => Object.fromEntries(entries)),
)

/** The shape of a segment's `.index.json`. */
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
  words: wordIndexSchema,
})

/**
 * Read and validate a JSON object, with its size.
 *
 * @returns Undefined when the object is missing or does not match `schema`.
 */
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
 * Text entries of a segment after entry `after`, read through its index so only the byte ranges
 * of about `limit` entries are fetched.
 *
 * @returns The entries, and `through`: the last entry returned, or undefined once the segment has
 * no text left after `after`.
 * @throws When the segment's index or entries are missing.
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
  const page = (await readSegment(bucket, prefix, { start: first.start, end: last.end }))
    .filter((entry) => entry.id > after)
    .slice(0, limit)
  const entries = page.flatMap(({ entry }) => (entry === undefined ? [] : (entryText(entry) ?? [])))
  return { entries, through: page.at(-1)?.id ?? last.last }
}
