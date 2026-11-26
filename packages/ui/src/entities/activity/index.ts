/**
 * The activity entity: what an agent did while nobody was watching, as a timeline.
 *
 * @see design/components/ActivityFeed
 * @module
 */

/** The timeline of events, newest first, with a compact form for the right pane. */
export { default as ActivityFeed } from './ui/ActivityFeed.svelte'
/** One event, its kinds, and how the feed writes its time. */
export { formatActivityTime, type ActivityItem, type ActivityKind } from './model/activity.js'
