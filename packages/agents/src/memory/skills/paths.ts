/** Skill names, R2 paths, and `SKILL.md` frontmatter (docs/design/long-term-memory.md, Skills). */
import type { skills } from '../store/schema/skills.ts'
import type { Scope } from '../store/schema/records.ts'
import { isScope } from '../store/scopes.ts'

export const MAX_SKILL_FILES = 32
export const MAX_SKILL_FILE_BYTES = 256 * 1024

const SKILL_NAME = /^[a-z0-9-]{1,64}$/
const SEGMENT = /^(?!\.+$)[A-Za-z0-9._-]{1,100}$/
const SUPPORT_DIRS = new Set(['references', 'assets', 'scripts'])

export type Skill = typeof skills.$inferSelect
export type SkillStatus = Skill['status']

export interface VisibleSkill {
  scope: Scope
  name: string
  description: string
}

export function skillDir(scope: Scope, name: string): string {
  return `skills/${scope}/${name}/`
}

export function blobKey(sha256: string): string {
  return `skills/.blobs/${sha256}`
}

/** The path a working agent reads a skill's instructions at. */
export function skillPath(skill: { scope: Scope; name: string }): string {
  return `/${skillDir(skill.scope, skill.name)}SKILL.md`
}

export function isSkillName(name: string): boolean {
  return SKILL_NAME.test(name)
}

/** `SKILL.md`, or a file below `references/`, `assets/`, or `scripts/`. */
export function isSkillFilePath(path: string): boolean {
  if (path === 'SKILL.md') return true
  const [dir, ...rest] = path.split('/')
  return (
    dir !== undefined &&
    SUPPORT_DIRS.has(dir) &&
    rest.length > 0 &&
    rest.every((s) => SEGMENT.test(s))
  )
}

/** `name` and `description` from the YAML frontmatter of a `SKILL.md`. */
export function parseSkillMd(text: string): { name: string; description: string } | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (match?.[1] === undefined) return undefined
  const fields = new Map<string, string>()
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([a-z_-]+):\s*(.*)$/.exec(line)
    if (field?.[1] === undefined || field[2] === undefined) continue
    fields.set(field[1], field[2].trim().replace(/^(["'])(.*)\1$/, '$2'))
  }
  const name = fields.get('name')
  const description = fields.get('description')
  return name === undefined || description === undefined ? undefined : { name, description }
}

/** `<scope>/<name>` into its parts; scopes contain no `/`. */
export function splitKey(key: string): [Scope, string] {
  const index = key.lastIndexOf('/')
  const scope = key.slice(0, index)
  if (index < 0 || !isScope(scope)) throw new TypeError(`Invalid skill key: ${key}`)
  return [scope, key.slice(index + 1)]
}
