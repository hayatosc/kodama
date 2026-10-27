/**
 * Pi entries as text: for extraction, for the archive index, and for the memory agent, which
 * reads them live or from the archive once they are pruned.
 *
 * @see docs/memory.md — Extract, Archive index
 *
 * @module
 */
import type { EntryRecord, EntryId, Harness } from '@earendil-works/pi-durable'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import { readArchivedText } from './archive/reader.ts'
import { prunedThrough } from '../storage/pruning.ts'
import type { MemoryDb } from './store/db.ts'
import { nextArchivedSegment } from './store/archive.ts'
import type { LocalDb } from '../storage/local.ts'

/** Characters of tool output kept in text; the archive keeps the full entry. */
export const TOOL_RESULT_TEXT_LIMIT = 2_000

/** Who an entry's text came from; `summary` is a compaction summary. */
export type EntryRole = 'user' | 'peer' | 'assistant' | 'tool' | 'summary' | 'other'

/** One entry as text. */
export interface EntryText {
  id: number
  role: EntryRole
  text: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Text of message content: a string, or text blocks and tool calls. */
function contentText(content: unknown, limit: number | undefined): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (!isRecord(block)) continue
    if (block['type'] === 'text' && typeof block['text'] === 'string') parts.push(block['text'])
    if (block['type'] === 'toolCall' && typeof block['name'] === 'string') {
      parts.push(`[tool ${block['name']} ${JSON.stringify(block['arguments'] ?? {})}]`)
    }
  }
  const text = parts.join('\n')
  return limit === undefined ? text : text.slice(0, limit)
}

function roleOf(kind: string): EntryRole {
  switch (kind) {
    case 'pi.user':
      return 'user'
    case 'kodama.agent-message':
      return 'peer'
    case 'pi.assistant':
      return 'assistant'
    case 'pi.tool-result':
      return 'tool'
    case 'pi.compaction':
      return 'summary'
    default:
      return 'other'
  }
}

/** The entry as text, or undefined for an entry that carries no conversation text. */
export function entryText(entry: EntryRecord): EntryText | undefined {
  const role = roleOf(entry.kind)
  if (role === 'other' || entry.model === undefined) return undefined
  const limit = role === 'tool' ? TOOL_RESULT_TEXT_LIMIT : undefined
  const text = entry.model
    .map((message: unknown) => (isRecord(message) ? contentText(message['content'], limit) : ''))
    .filter((part) => part.length > 0)
    .join('\n')
  return text.length === 0 ? undefined : { id: entry.id, role, text }
}

const context = BACKGROUND_CONTEXT
/** Entries per page, at most. */
const PAGE_LIMIT = 200

/** A page of conversation text for the memory agent's extraction. */
export interface EntryPage {
  entries: EntryText[]
  /** The last entry ID the page covered, including entries without text. */
  through: number
  end: boolean
}

/**
 * Where an agent's entries are: live in its harness, or archived in R2 below the pruned boundary.
 */
export interface EntrySources {
  agentId: string
  harness: () => Promise<Harness>
  local: () => Promise<LocalDb>
  db: MemoryDb
  archive: R2Bucket
}

/** Entry IDs cross RPC as plain numbers; Pi's are non-negative integers. */
function isEntryId(value: number): value is EntryId {
  return Number.isSafeInteger(value) && value >= 0
}

/**
 * Text of the entries after `after`, oldest first.
 *
 * @remarks
 * Entries below the pruned boundary are read back from their archived segment, so an extraction
 * that fell behind still sees every entry.
 *
 * @throws {@link TypeError} When `after` is not a non-negative integer.
 */
export async function readEntries(
  sources: EntrySources,
  request: { after: number; limit: number },
): Promise<EntryPage> {
  const limit = Math.min(Math.max(1, request.limit), PAGE_LIMIT)
  const first = request.after + 1
  if (!isEntryId(first)) throw new TypeError('after must be an entry ID')
  const pruned = prunedThrough(await sources.local())
  if (first <= pruned) return readArchived(sources, request.after, limit, pruned)
  const harness = await sources.harness()
  const page = await harness.commit(
    (tx) =>
      tx.scanEntries(
        { conversationId: ROOT_CONVERSATION_ID, minEntryId: first, order: 'ascending' },
        limit,
      ),
    context,
  )
  return {
    entries: page.items.flatMap((entry) => entryText(entry) ?? []),
    through: page.items.at(-1)?.id ?? request.after,
    end: page.next === undefined,
  }
}

async function readArchived(
  sources: EntrySources,
  after: number,
  limit: number,
  pruned: number,
): Promise<EntryPage> {
  const segment = await nextArchivedSegment(sources.db, sources.agentId, after)
  // Without an archive (the memory agent's own history), the pruned range has no text left.
  if (segment === undefined || segment.firstEntry > pruned) {
    return { entries: [], through: pruned, end: false }
  }
  const page = await readArchivedText(sources.archive, segment.r2Prefix, after, limit)
  return { entries: page.entries, through: page.through ?? segment.lastEntry, end: false }
}

/** The newest entry of the root conversation, or undefined in an empty one. */
export async function latestEntryId(harness: Harness): Promise<number | undefined> {
  return harness.commit(async (tx) => {
    const page = await tx.scanEntries(
      { conversationId: ROOT_CONVERSATION_ID, order: 'descending' },
      1,
    )
    return page.items[0]?.id
  }, context)
}
