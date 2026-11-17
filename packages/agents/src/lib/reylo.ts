/**
 * Shared Reylo SQLite/D1 execution, batching, and row-decoding helpers.
 *
 * @module
 */
import type { Cardinality, ParamsArg, Query } from 'reylo'

/** Prepare a D1 statement from a typed Reylo SQLite query and its encoded parameters. */
export function prepareQuery<Params, Row, C extends Cardinality, E>(
  d1: D1Database,
  query: Query<Params, Row, C, 'sqlite', E>,
  ...args: ParamsArg<Params>
): D1PreparedStatement {
  const sq = query['~standard'].query
  return d1.prepare(sq.text).bind(...sq.encode(args[0] ?? {}))
}

/** Execute prepared statements in a single atomic D1 batch, skipping empty batches. */
export async function runBatch(
  d1: D1Database,
  statements: readonly D1PreparedStatement[],
): Promise<D1Result[]> {
  if (statements.length === 0) return []
  return d1.batch([...statements])
}

/** Execute a write statement on D1 and return the number of modified rows (`meta.changes`). */
export async function runChanges<Params, Row, C extends Cardinality, E>(
  d1: D1Database,
  query: Query<Params, Row, C, 'sqlite', E>,
  ...args: ParamsArg<Params>
): Promise<number> {
  const result = await prepareQuery(d1, query, ...args).run()
  return result.meta.changes ?? 0
}

/** Narrow a string read from SQLite against a tuple of permitted enum literals. */
export function parseEnum<const T extends readonly [string, ...string[]]>(
  allowed: T,
  value: string,
  label = 'value',
): T[number] {
  for (const candidate of allowed) {
    if (candidate === value) return candidate
  }
  throw new TypeError(`Unexpected ${label}: ${value}`)
}

/** Narrow a nullable string read from SQLite against a tuple of permitted enum literals. */
export function parseNullableEnum<const T extends readonly [string, ...string[]]>(
  allowed: T,
  value: string | null,
  label = 'value',
): T[number] | null {
  return value === null ? null : parseEnum(allowed, value, label)
}

/** Parse a JSON text column into `unknown` for schema validation. */
export function parseJsonValue(raw: string): unknown {
  const parsed: unknown = JSON.parse(raw)
  return parsed
}

/** Split a SQLite migration script into executable statements, ignoring comments and whitespace. */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let start = 0
  let hasToken = false
  let i = 0
  while (i < sql.length) {
    const ch = sql[i]
    const next = sql[i + 1]
    if (ch === '-' && next === '-') {
      i += 2
      while (i < sql.length && sql[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      hasToken = true
      i += 1
      while (i < sql.length) {
        if (sql[i] === ch) {
          if (sql[i + 1] === ch) i += 2
          else {
            i += 1
            break
          }
        } else {
          i += 1
        }
      }
      continue
    }
    if (ch === ';') {
      if (hasToken) {
        const stmt = sql.slice(start, i).trim()
        if (stmt.length > 0) statements.push(stmt)
      }
      i += 1
      start = i
      hasToken = false
      continue
    }
    if (ch !== undefined && !/\s/.test(ch)) hasToken = true
    i += 1
  }
  if (hasToken) {
    const tail = sql.slice(start).trim()
    if (tail.length > 0) statements.push(tail)
  }
  return statements
}
