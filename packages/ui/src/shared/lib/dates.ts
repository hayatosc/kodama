/**
 * Date helpers the time labels share.
 *
 * @module
 */

/** How many local calendar days `later` falls after `earlier`, ignoring the time of day. */
export function calendarDaysBetween(earlier: Date, later: Date): number {
  const start = new Date(earlier.getFullYear(), earlier.getMonth(), earlier.getDate())
  const end = new Date(later.getFullYear(), later.getMonth(), later.getDate())
  return Math.round((end.getTime() - start.getTime()) / 86_400_000)
}
