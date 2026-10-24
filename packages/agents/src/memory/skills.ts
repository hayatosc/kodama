/**
 * Skill naming, size limits, and write validation, independent of persistence and tools.
 *
 * @see docs/memory.md — Skills
 *
 * @module
 */

/** What a working agent's `skills` section lists. */
export interface VisibleSkill {
  name: string
  description: string
}

/** A skill name: 1–64 lowercase letters, digits, or hyphens. */
export const SKILL_NAME_PATTERN = /^[a-z0-9-]{1,64}$/
/** Longest skill description, in characters. */
export const MAX_SKILL_DESCRIPTION = 1_024
/** Longest skill body, in characters. */
export const MAX_SKILL_BODY = 50_000
/** Skills listed per agent; selection gets worse as the list grows. */
export const SKILL_LIST_LIMIT = 50
/** Days without a use or a write before consolidation archives a skill. */
export const SKILL_ARCHIVE_DAYS = 30

/** Whether `name` is a valid skill name. */
export function isSkillName(name: string): boolean {
  return SKILL_NAME_PATTERN.test(name)
}

/** A skill to create or overwrite. */
export interface SkillWrite {
  agentId: string
  name: string
  description: string
  body: string
  evidence: string
  /** The revision the writer read; omitted to create the skill. */
  revision?: number
}

/**
 * Validate and normalize a skill before any storage operation.
 *
 * @throws {@link TypeError} When the name, description, or body breaks its limits.
 */
export function checkedSkill(write: SkillWrite): SkillWrite {
  if (!isSkillName(write.name)) throw new TypeError(`Invalid skill name: ${write.name}`)
  const description = write.description.trim()
  const body = write.body.trim()
  if (description.length === 0 || description.length > MAX_SKILL_DESCRIPTION) {
    throw new TypeError(`A skill description has 1–${MAX_SKILL_DESCRIPTION} characters`)
  }
  if (body.length === 0 || body.length > MAX_SKILL_BODY) {
    throw new TypeError(`A skill body has 1–${MAX_SKILL_BODY} characters`)
  }
  return { ...write, description, body }
}
