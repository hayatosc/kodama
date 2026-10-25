/**
 * Reading errors that wrap other errors.
 *
 * @module
 */

/** Messages of an error and its causes; Drizzle wraps the D1 error in `cause`. */
export function errorText(error: unknown): string {
  const parts: string[] = []
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    parts.push(current.message)
  }
  return parts.join('\n')
}

/** Whether a database write failed on a constraint (key, foreign key, unique, or check). */
export function isConstraintError(error: unknown): boolean {
  return /constraint/i.test(errorText(error))
}
