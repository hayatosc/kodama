/**
 * Permanent root contact, and the URLs with provenance outside the model that `web_fetch` may
 * reach after it.
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

/** The first contact wins, including across eviction and failed requests. */
export function markContact(local: LocalDb, root: string, reason: string, eligibleThrough: number) {
  local
    .insert(externalData)
    .values({ root, reason, eligibleThrough, contactedAt: Date.now() })
    .onConflictDoNothing()
    .run()
}

/** Undefined means no external contact has occurred. */
export function contactBoundary(local: LocalDb, root: string): number | undefined {
  return local.select().from(externalData).where(eq(externalData.root, root)).get()?.eligibleThrough
}

/** Refuse before side effects; callers serialize this check with contact admission. */
export function requireTrusted(local: LocalDb, root: string): void {
  if (contactBoundary(local, root) !== undefined) throw new Error('untrusted_context')
}

/**
 * Record normalized URLs from adopted owner input or validated search sources. Granting a known
 * URL again refreshes it, so the newest {@link KNOWN_URL_LIMIT} stay.
 */
export function grantUrls(
  local: LocalDb,
  root: string,
  source: 'owner' | 'search',
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

/** Whether `url` came from the owner or a search result of this root. */
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
 * Admit one web call and establish contact in one SQLite transaction. After contact a fetch must
 * target a known URL; a search is the caller's to check, since its rule depends on the query text.
 *
 * @throws {@link Error} `unverified_url` When contact exists and the fetch URL is unknown.
 */
export function admitWeb(
  local: LocalDb,
  request: {
    root: string
    tool: 'web_search' | 'web_fetch'
    argument: string
    eligibleThrough: number
  },
): void {
  local.transaction((tx) => {
    if (
      request.tool === 'web_fetch' &&
      contactBoundary(tx, request.root) !== undefined &&
      !isKnownUrl(tx, request.root, request.argument)
    )
      throw new Error('unverified_url')
    markContact(tx, request.root, request.tool, request.eligibleThrough)
  })
}
