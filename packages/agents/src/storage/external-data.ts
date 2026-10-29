/** Permanent root contact and atomic one-shot web admission. @module */
import { and, eq, gte, inArray, isNull, isNotNull, ne, or } from 'drizzle-orm'
import { externalData, usage, webPermissions } from '../../drizzle/durable-object/schema.ts'
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

/** Consume permission, count admission, and establish contact in one SQLite transaction. */
export function admitWeb(
  local: LocalDb,
  request: {
    seq: number
    root: string
    run: string
    inputs: number[]
    tool: 'web_search' | 'web_fetch'
    argument: string
    keyless: boolean
    eligibleThrough: number
  },
  now = Date.now(),
): string | null {
  return local.transaction((tx) => {
    const active = tx
      .select()
      .from(usage)
      .where(
        and(
          eq(usage.kind, 'tool'),
          eq(usage.status, 'in_flight'),
          or(isNotNull(usage.api), isNotNull(usage.admittedAt)),
          ne(usage.seq, request.seq),
        ),
      )
      .all()
    if (active.length >= 2 || (request.keyless && active.some((row) => row.keyless)))
      throw new Error('busy')
    const recent = tx
      .select()
      .from(usage)
      .where(and(eq(usage.tool, request.tool), gte(usage.admittedAt, now - 60_000)))
      .all()
    if (recent.length >= (request.tool === 'web_search' ? 10 : 30)) throw new Error('rate_limited')
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
    tx.update(usage)
      .set({
        admittedAt: now,
        keyless: request.keyless,
        root: request.root,
        run: request.run,
        argument: request.argument,
      })
      .where(eq(usage.seq, request.seq))
      .run()
    return permission?.key ?? null
  })
}

/** Reserve capacity during scoped auth as well as transport; no contact or permission is consumed. */
export function reserveWeb(local: LocalDb, seq: number, keyless: boolean, api: string): void {
  local.transaction((tx) => {
    const active = tx
      .select()
      .from(usage)
      .where(
        and(
          eq(usage.kind, 'tool'),
          eq(usage.status, 'in_flight'),
          or(isNotNull(usage.api), isNotNull(usage.admittedAt)),
          ne(usage.seq, seq),
        ),
      )
      .all()
    if (active.length >= 2 || (keyless && active.some((row) => row.keyless)))
      throw new Error('busy')
    tx.update(usage).set({ keyless, api }).where(eq(usage.seq, seq)).run()
  })
}
