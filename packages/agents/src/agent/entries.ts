/** Conversation text for the memory agent's extraction, live or archived (Extract, Pruning). */
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import type { EntryId, Harness } from '@earendil-works/pi-durable'
import { and, asc, eq, gt } from 'drizzle-orm'
import { readArchivedText } from '../memory/archive.ts'
import { prunedThrough } from '../memory/prune.ts'
import type { MemoryDb } from '../memory/records.ts'
import { archiveSegments } from '../memory/schema.ts'
import { entryText } from '../memory/transcript.ts'
import type { EntryText } from '../memory/transcript.ts'
import type { LocalDb } from '../storage/local.ts'

const context = BACKGROUND_CONTEXT
const PAGE_LIMIT = 200

/** A page of conversation text for the memory agent's extraction. */
export interface EntryPage {
  entries: EntryText[]
  /** The last entry ID the page covered, including entries without text. */
  through: number
  end: boolean
}

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
 * Text of the entries after `after`, oldest first. Pruned entries are read back from their
 * archived segment.
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
  const segment = await sources.db
    .select()
    .from(archiveSegments)
    .where(and(eq(archiveSegments.agentId, sources.agentId), gt(archiveSegments.lastEntry, after)))
    .orderBy(asc(archiveSegments.firstEntry))
    .limit(1)
    .get()
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
