/**
 * URL provenance for every web fetch. Legacy contact rows remain readable for migration tests
 * but no longer control permissions or learning.
 *
 * @see docs/agents.md — Public web tools
 *
 * @module
 */
import type { LocalDb } from './local.ts'
import insertExternalData from './sql/insert-external-data.sql'
import selectExternalData from './sql/select-external-data.sql'
import selectKnownUrl from './sql/select-known-url.sql'
import trimKnownUrls from './sql/trim-known-urls.sql'
import upsertKnownUrl from './sql/upsert-known-url.sql'

/** Known URLs kept per root; granting more drops the least recently granted. */
export const KNOWN_URL_LIMIT = 1000

/** Preserve the legacy contact-row writer for compatibility tests; not an admission operation. */
export function markContact(local: LocalDb, root: string, reason: string, eligibleThrough: number) {
  insertExternalData.runSync(local.sql, {
    root,
    reason,
    eligibleThrough,
    contactedAt: Date.now(),
  })
}

/** Read historical contact metadata, which no longer conveys trust or permissions. */
export function contactBoundary(local: LocalDb, root: string): number | undefined {
  return selectExternalData.runSync(local.sql, { root })?.eligibleThrough
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
  local.transactionSync(() => {
    for (const url of new Set(urls)) {
      upsertKnownUrl.runSync(local.sql, { root, url, source, grantedAt: now })
    }
    trimKnownUrls.runSync(local.sql, { root, offset: KNOWN_URL_LIMIT })
  })
}

/** Whether `url` came from the owner, a search result or a fetched page of this root. */
export function isKnownUrl(local: LocalDb, root: string, url: string): boolean {
  return selectKnownUrl.runSync(local.sql, { root, url }) !== null
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
  local.transactionSync(() => {
    if (request.tool === 'web_fetch' && !isKnownUrl(local, request.root, request.argument))
      throw new Error('unverified_url')
  })
}
