/** Permanent root contact and atomic one-shot web permission consumption. @module */
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { externalData, webPermissions } from '../../../drizzle/durable-object/schema.ts'
import type { LocalDb } from './local.ts'

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

/** Persist permissions from a verified adopted owner entry, without resetting consumption. */
export function adoptPermissions(
  local: LocalDb,
  root: string,
  run: string,
  input: number,
  permissions: { queries?: string[]; urls?: string[] },
) {
  for (const [tool, args] of [
    ['web_search', permissions.queries],
    ['web_fetch', permissions.urls],
  ] as const) {
    for (const argument of new Set(args)) {
      local
        .insert(webPermissions)
        .values({
          key: JSON.stringify([root, input, tool, argument]),
          root,
          run,
          input,
          tool,
          argument,
        })
        .onConflictDoNothing()
        .run()
    }
  }
}

/** Validated search sources grant one fetch each in the same run, never page-link permissions. */
export function grantSources(
  local: LocalDb,
  root: string,
  run: string,
  urls: readonly string[],
): void {
  for (const argument of urls.slice(0, 20)) {
    local
      .insert(webPermissions)
      .values({
        key: JSON.stringify([root, run, 'source', argument]),
        root,
        run,
        tool: 'web_fetch',
        argument,
      })
      .onConflictDoNothing()
      .run()
  }
}

/** Consume permission and establish contact in one SQLite transaction. */
export function admitWeb(
  local: LocalDb,
  request: {
    root: string
    run: string
    inputs: number[]
    tool: 'web_search' | 'web_fetch'
    argument: string
    eligibleThrough: number
  },
  now = Date.now(),
): string | null {
  return local.transaction((tx) => {
    const permission = tx
      .select()
      .from(webPermissions)
      .where(
        and(
          eq(webPermissions.root, request.root),
          eq(webPermissions.tool, request.tool),
          eq(webPermissions.argument, request.argument),
          isNull(webPermissions.consumedAt),
          and(
            eq(webPermissions.run, request.run),
            or(isNull(webPermissions.input), inArray(webPermissions.input, request.inputs)),
          ),
        ),
      )
      .get()
    if (contactBoundary(tx, request.root) !== undefined && !permission)
      throw new Error('untrusted_context')
    if (permission)
      tx.update(webPermissions)
        .set({ run: request.run, consumedAt: now })
        .where(eq(webPermissions.key, permission.key))
        .run()
    markContact(tx, request.root, request.tool, request.eligibleThrough)
    return permission?.key ?? null
  })
}
