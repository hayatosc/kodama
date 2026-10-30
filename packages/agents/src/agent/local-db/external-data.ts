/**
 * URL provenance for every web fetch. Legacy contact rows remain readable for migration tests
 * but no longer control permissions or learning.
 *
 * @see docs/agents.md — Public web tools
 *
 * @module
 */
import { and, desc, eq, inArray } from 'drizzle-orm'
import { externalData, knownUrls } from '../../../drizzle/durable-object/schema.ts'
import type { LocalDb } from './local.ts'

/** Known URLs kept per root; granting more drops the least recently granted. */
export const KNOWN_URL_LIMIT = 1000

/** Preserve the legacy contact-row writer for compatibility tests; not an admission operation. */
export function markContact(local: LocalDb, root: string, reason: string, eligibleThrough: number) {
  local
    .insert(externalData)
    .values({ root, reason, eligibleThrough, contactedAt: Date.now() })
    .onConflictDoNothing()
    .run()
}

/** Read historical contact metadata, which no longer conveys trust or permissions. */
export function contactBoundary(local: LocalDb, root: string): number | undefined {
  return local.select().from(externalData).where(eq(externalData.root, root)).get()?.eligibleThrough
}

/**
 * Record normalized URLs from owner messages, validated search sources or fetched pages' links.
 * Granting a known URL again refreshes it, so the newest {@link KNOWN_URL_LIMIT} stay.
 */
export function grantUrls(
  local: LocalDb,
  root: string,
  source: 'owner' | 'search' | 'page',
  urls: readonly string[],
  now = Date.now(),
): void {
  if (urls.length === 0) return
  local.transaction((tx) => {
    for (const url of new Set(urls)) {
      tx.insert(knownUrls)
        .values({ root, url, source, grantedAt: now })
        .onConflictDoUpdate({ target: [knownUrls.root, knownUrls.url], set: { grantedAt: now } })
        .run()
    }
    const stale = tx
      .select({ url: knownUrls.url })
      .from(knownUrls)
      .where(eq(knownUrls.root, root))
      .orderBy(desc(knownUrls.grantedAt))
      // SQLite needs a LIMIT before OFFSET; this one never binds.
      .limit(Number.MAX_SAFE_INTEGER)
      .offset(KNOWN_URL_LIMIT)
    tx.delete(knownUrls)
      .where(and(eq(knownUrls.root, root), inArray(knownUrls.url, stale)))
      .run()
  })
}

/** Whether `url` came from the owner, a search result or a fetched page of this root. */
export function isKnownUrl(local: LocalDb, root: string, url: string): boolean {
  return (
    local
      .select({ url: knownUrls.url })
      .from(knownUrls)
      .where(and(eq(knownUrls.root, root), eq(knownUrls.url, url)))
      .get() !== undefined
  )
}

/**
 * Require URL provenance on every fetch, including the first. Search query checks live with
 * the caller. Historical contact rows are not authorization or memory-learning policy.
 *
 * @throws {@link Error} `unverified_url` When the fetch URL is unknown.
 */
export function admitWeb(
  local: LocalDb,
  request: {
    root: string
    tool: 'web_search' | 'web_fetch'
    argument: string
  },
): void {
  local.transaction((tx) => {
    if (request.tool === 'web_fetch' && !isKnownUrl(tx, request.root, request.argument))
      throw new Error('unverified_url')
  })
}
