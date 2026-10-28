/** Typed SQL expressions shared by database query builders. @module */
import { sql } from 'drizzle-orm'
import type { AnyColumn, SQL } from 'drizzle-orm'

/** Select the fallback only when the first expression is null; both operands share a data type. */
export function coalesce<T>(
  value: AnyColumn<{ data: T }> | SQL<T>,
  fallback: NoInfer<T> | AnyColumn<{ data: NoInfer<T> }> | SQL<NoInfer<T>>,
): SQL<T> {
  return sql<T>`coalesce(${value}, ${fallback})`
}

/** Bind a literal in a SELECT projection without letting callers assert its result type. */
export function literal<const T extends string | number | boolean | null>(value: T): SQL<T> {
  return sql<T>`${value}`
}
