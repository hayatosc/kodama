/** Typed SQL expressions shared by database query builders. @module */
import { sql } from 'drizzle-orm'
import type { AnyColumn, SQL } from 'drizzle-orm'

type NumericExpression = AnyColumn<{ data: number }> | SQL<number> | number

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

/** Sum numeric values matching a builder predicate, returning zero for an empty input. */
export function sumWhen(condition: SQL | undefined, value: NumericExpression): SQL<number> {
  if (condition === undefined) throw new TypeError('A conditional sum requires a predicate')
  return sql<number>`coalesce(sum(case when ${condition} then ${value} else 0 end), 0)`.mapWith(
    Number,
  )
}

/** Add to a numeric column within the update statement, without a read-modify-write race. */
export function increment(column: AnyColumn<{ data: number }>, by: NumericExpression): SQL<number> {
  return sql<number>`${column} + ${by}`
}

/** Encode ordered column values as the stable SQLite JSON-array grouping and cursor key. */
export function groupKey(...columns: [AnyColumn, ...AnyColumn[]]): SQL<string> {
  return sql<string>`json_array(${sql.join(columns, sql`, `)})`
}

/** Add a known observation without converting entirely unknown measurements into zero. */
export function addObservation(column: AnyColumn<{ data: number }>, value: number | null) {
  return value === null ? sql`${column}` : sql<number>`coalesce(${column}, 0) + ${value}`
}
