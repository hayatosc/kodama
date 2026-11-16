/**
 * Task progress naming, size limits, and write validation, independent of persistence and tools.
 *
 * @see docs/memory.md — Task progress
 *
 * @module
 */
/** Lifecycle statuses persisted for a working agent's durable task checkpoint. */
export const TASK_PROGRESS_STATUSES = ['in_progress', 'blocked', 'completed', 'archived'] as const
/** Lifecycle states for a working agent's durable task checkpoint. */
export type TaskProgressStatus = (typeof TASK_PROGRESS_STATUSES)[number]

/** What a working agent's `tasks` section lists in the always-loaded index. */
export interface VisibleTask {
  slug: string
  title: string
  status: 'in_progress' | 'blocked'
  summary: string
}

/** A task slug: 1–64 lowercase letters, digits, or hyphens. */
export const TASK_SLUG_PATTERN = /^[a-z0-9-]{1,64}$/
/** Longest task title, in characters. */
export const MAX_TASK_TITLE = 128
/** Longest one-line summary for the always-loaded task index, in characters. */
export const MAX_TASK_SUMMARY = 280
/** Longest task body (notes, checklist, blockers), in characters. */
export const MAX_TASK_BODY = 16_000
/** Active task checkpoints listed in the always-loaded prompt index. */
export const TASK_LIST_LIMIT = 20
/** Days after completion before consolidation archives a task checkpoint. */
export const TASK_ARCHIVE_DAYS = 30

/** Whether `slug` is a valid task slug. */
export function isTaskSlug(slug: string): boolean {
  return TASK_SLUG_PATTERN.test(slug)
}

/** A task checkpoint to create or update. */
export interface TaskProgressWrite {
  agentId: string
  slug: string
  title: string
  status: TaskProgressStatus
  summary: string
  body: string
  /** Optional optimistic revision check; omitted performs a last-writer-wins upsert. */
  revision?: number
}

/**
 * Validate and normalize a task progress checkpoint before any storage operation.
 *
 * @throws {@link TypeError} When the slug, title, summary, or body breaks its limits.
 */
export function checkedTaskProgress(write: TaskProgressWrite): TaskProgressWrite {
  if (!isTaskSlug(write.slug)) throw new TypeError(`Invalid task slug: ${write.slug}`)
  const title = write.title.trim()
  const summary = write.summary.trim()
  const body = write.body.trim()
  if (title.length === 0 || title.length > MAX_TASK_TITLE) {
    throw new TypeError(`A task title has 1–${MAX_TASK_TITLE} characters`)
  }
  if (summary.length === 0 || summary.length > MAX_TASK_SUMMARY) {
    throw new TypeError(`A task summary has 1–${MAX_TASK_SUMMARY} characters`)
  }
  if (body.length === 0 || body.length > MAX_TASK_BODY) {
    throw new TypeError(`A task body has 1–${MAX_TASK_BODY} characters`)
  }
  return { ...write, title, summary, body }
}
