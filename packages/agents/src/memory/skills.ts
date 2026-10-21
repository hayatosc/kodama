/**
 * Skills: Agent Skills directories in R2, their rows in D1, writes that a stop can finish,
 * visibility, usage, and curation (docs/design/long-term-memory.md, Skills).
 */
import { and, eq, inArray } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import * as v from 'valibot'
import type { MemoryDb, OperationContext, OperationResult, Scope } from './records.ts'
import { appliedResult, bumpScope, claimRevision, insertOp } from './records.ts'
import { memoryLedger, skillUsage, skills, skillWrites } from './schema.ts'
import { readableScopes } from './working.ts'

export const SKILL_LIST_LIMIT = 50
export const MAX_SKILL_FILES = 32
export const MAX_SKILL_FILE_BYTES = 256 * 1024
const DAY_MS = 24 * 60 * 60 * 1000
/** Days without use before a skill becomes stale, then archived. */
export const SKILL_CURATION_DAYS = { agent: [14, 30], shared: [30, 60] } as const
/** Blobs no retained ledger row or pending write needs are deleted after this long. */
export const SKILL_BLOB_GRACE_MS = DAY_MS

const SKILL_NAME = /^[a-z0-9-]{1,64}$/
const SEGMENT = /^(?!\.+$)[A-Za-z0-9._-]{1,100}$/
const SUPPORT_DIRS = new Set(['references', 'assets', 'scripts'])

export type Skill = typeof skills.$inferSelect
export type SkillStatus = Skill['status']
type SkillWriteRow = typeof skillWrites.$inferSelect
type Statement = BatchItem<'sqlite'>

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

async function sha256Hex(bytes: Uint8Array | string): Promise<string> {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
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

const changesSchema = v.array(
  v.object({ path: v.string(), before: v.nullable(v.string()), after: v.nullable(v.string()) }),
)
const writeMetaSchema = v.object({
  jobId: v.string(),
  runId: v.string(),
  actor: v.string(),
  description: v.string(),
  status: v.picklist(['proposed', 'active', 'stale', 'archived']),
  evidence: v.string(),
  basedOn: v.nullable(v.string()),
  contentSha256: v.string(),
})

export type FileChange = v.InferOutput<typeof changesSchema>[number]

/** The SHA-256 of each file in a skill directory. */
async function currentFiles(bucket: R2Bucket, dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix: dir, ...(cursor === undefined ? {} : { cursor }) })
    for (const object of page.objects) {
      const body = await bucket.get(object.key)
      if (body === null) continue
      files.set(
        object.key.slice(dir.length),
        await sha256Hex(new Uint8Array(await body.arrayBuffer())),
      )
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor !== undefined && files.size <= MAX_SKILL_FILES)
  return files
}

async function contentSha256(files: ReadonlyMap<string, string>): Promise<string> {
  const lines = [...files].sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, s]) => `${p}:${s}\n`)
  return sha256Hex(lines.join(''))
}

async function storeBlob(bucket: R2Bucket, sha256: string, body: ArrayBuffer | string) {
  if ((await bucket.head(blobKey(sha256))) !== null) return
  await bucket.put(blobKey(sha256), body, { sha256 })
}

export interface SkillWriteRequest {
  scope: Scope
  name: string
  /** New content per path; null removes the file. Paths not named stay as they are. */
  files: Readonly<Record<string, string | null>>
  /** The revision the writer read; undefined creates the skill. */
  baseRevision: number | undefined
  status: 'proposed' | 'active'
  evidence: string
  basedOn?: string
}

type WriteResult = OperationResult & { replayed: boolean }

/**
 * Overwrite a skill in place as one operation: blobs first, then a `pending` skill_writes row,
 * then the directory, then one batch for the row, ledger, scope revision, and memory_ops. A stop
 * at any point is finished by `finishPendingSkillWrites`.
 */
export async function writeSkill(
  db: MemoryDb,
  bucket: R2Bucket,
  ctx: OperationContext,
  request: SkillWriteRequest,
): Promise<WriteResult> {
  const earlier = await appliedResult(db, ctx.opId)
  if (earlier !== undefined) return { ...earlier, replayed: true }
  const started = await db.select().from(skillWrites).where(eq(skillWrites.opId, ctx.opId)).get()
  if (started !== undefined) return finishSkillWrite(db, bucket, started, ctx.now)
  if (!isSkillName(request.name)) throw new TypeError(`Invalid skill name: ${request.name}`)

  const current = await db
    .select()
    .from(skills)
    .where(and(eq(skills.scope, request.scope), eq(skills.name, request.name)))
    .get()
  if (request.baseRevision === undefined && current !== undefined) {
    return { status: 'conflict', reason: 'exists', replayed: false }
  }
  if (request.baseRevision !== undefined && current?.revision !== request.baseRevision) {
    return { status: 'conflict', reason: 'target_changed', replayed: false }
  }

  const dir = skillDir(request.scope, request.name)
  const existing =
    current === undefined ? new Map<string, string>() : await currentFiles(bucket, dir)
  const final = new Map(existing)
  const changes: FileChange[] = []
  const uploads = new Map<string, string>()
  for (const [path, content] of Object.entries(request.files)) {
    if (!isSkillFilePath(path)) throw new TypeError(`Invalid skill file path: ${path}`)
    const before = existing.get(path) ?? null
    if (content === null) {
      if (before === null) continue
      changes.push({ path, before, after: null })
      final.delete(path)
      continue
    }
    if (new TextEncoder().encode(content).byteLength > MAX_SKILL_FILE_BYTES) {
      throw new TypeError(`${path} is larger than ${MAX_SKILL_FILE_BYTES} bytes`)
    }
    const after = await sha256Hex(content)
    if (after === before) continue
    changes.push({ path, before, after })
    uploads.set(after, content)
    final.set(path, after)
  }
  if (final.size > MAX_SKILL_FILES)
    throw new TypeError(`A skill has at most ${MAX_SKILL_FILES} files`)

  const skillMd =
    request.files['SKILL.md'] ?? (await (await bucket.get(`${dir}SKILL.md`))?.text()) ?? undefined
  const front = skillMd === undefined || skillMd === null ? undefined : parseSkillMd(skillMd)
  if (front === undefined)
    throw new TypeError('SKILL.md needs frontmatter with name and description')
  if (front.name !== request.name)
    throw new TypeError('The SKILL.md name must match the skill name')
  if (front.description.length === 0 || front.description.length > 1024) {
    throw new TypeError('The description must have 1–1024 characters')
  }

  for (const [sha, content] of uploads) await storeBlob(bucket, sha, content)
  for (const change of changes) {
    if (change.before === null) continue
    const old = await bucket.get(dir + change.path)
    if (old !== null) await storeBlob(bucket, change.before, await old.arrayBuffer())
  }
  const meta: v.InferOutput<typeof writeMetaSchema> = {
    jobId: ctx.jobId,
    runId: ctx.runId,
    actor: ctx.actor,
    description: front.description,
    status: request.status,
    evidence: request.evidence,
    basedOn: request.basedOn ?? null,
    contentSha256: await contentSha256(final),
  }
  const row = {
    opId: ctx.opId,
    scope: request.scope,
    name: request.name,
    baseRevision: current?.revision ?? null,
    filesJson: JSON.stringify(changes),
    skillJson: JSON.stringify(meta),
    status: 'pending' as const,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  }
  await db.insert(skillWrites).values(row).onConflictDoNothing()
  return finishSkillWrite(db, bucket, row, ctx.now)
}

/** Copy the after files into the directory, `SKILL.md` last, then commit the row in one batch. */
async function finishSkillWrite(
  db: MemoryDb,
  bucket: R2Bucket,
  row: SkillWriteRow,
  now: number,
): Promise<WriteResult> {
  const changes = v.parse(changesSchema, JSON.parse(row.filesJson))
  const meta = v.parse(writeMetaSchema, JSON.parse(row.skillJson))
  const dir = skillDir(row.scope, row.name)
  const ordered = [
    ...changes.filter((change) => change.path !== 'SKILL.md'),
    ...changes.filter((change) => change.path === 'SKILL.md'),
  ]
  for (const change of ordered) {
    if (change.after === null) {
      await bucket.delete(dir + change.path)
      continue
    }
    const blob = await bucket.get(blobKey(change.after))
    if (blob === null) throw new Error(`Skill blob ${change.after} is missing`)
    await bucket.put(dir + change.path, await blob.arrayBuffer())
  }

  const ctx: OperationContext = {
    opId: row.opId,
    jobId: meta.jobId,
    runId: meta.runId,
    actor: meta.actor,
    now,
  }
  const key = `${row.scope}/${row.name}`
  const result: OperationResult = { status: 'applied', recordId: key }
  const fields = {
    description: meta.description,
    status: meta.status,
    contentSha256: meta.contentSha256,
    evidenceJson: JSON.stringify(meta.evidence),
    basedOn: meta.basedOn,
    updatedAt: now,
  }
  const upsert: Statement[] =
    row.baseRevision === null
      ? [
          db.insert(skills).values({
            scope: row.scope,
            name: row.name,
            r2Key: dir,
            revision: 1,
            createdAt: now,
            ...fields,
          }),
        ]
      : [
          db
            .update(skills)
            .set({ ...fields, revision: row.baseRevision + 1 })
            .where(
              and(
                eq(skills.scope, row.scope),
                eq(skills.name, row.name),
                eq(skills.revision, row.baseRevision),
              ),
            ),
          claimRevision(db, ctx, 'skill', key, row.baseRevision + 1),
        ]
  const done = db
    .update(skillWrites)
    .set({ status: 'done', updatedAt: now })
    .where(eq(skillWrites.opId, row.opId))
  try {
    await db.batch([
      insertOp(db, ctx, 'skill_write', result),
      ...upsert,
      skillLedger(db, ctx, 'write', key, changes),
      bumpScope(db, ctx, row.scope),
      done,
    ])
  } catch (error) {
    const applied = await appliedResult(db, row.opId)
    if (applied !== undefined) return { ...applied, replayed: true }
    if (!/constraint/i.test(errorText(error))) throw error
    // Only the memory agent writes skills, one job at a time, so this means a bug, not a race.
    await db.batch([
      done,
      skillLedger(db, ctx, 'conflict', key, { reason: 'changed_during_write' }),
    ])
    return { status: 'conflict', reason: 'changed_during_write', replayed: false }
  }
  return { ...result, replayed: false }
}

function errorText(error: unknown): string {
  const parts: string[] = []
  for (let cause: unknown = error; cause instanceof Error; cause = cause.cause) {
    parts.push(cause.message)
  }
  return parts.join(' ')
}

function skillLedger(
  db: MemoryDb,
  ctx: OperationContext,
  action: string,
  key: string,
  detail: unknown,
) {
  return db.insert(memoryLedger).values({
    at: ctx.now,
    runId: ctx.runId,
    opId: ctx.opId,
    actor: ctx.actor,
    action,
    target: 'skill',
    targetId: key,
    detailJson: JSON.stringify(detail),
  })
}

/** Finish every write a stop left `pending`; the memory agent runs this on start and before jobs. */
export async function finishPendingSkillWrites(
  db: MemoryDb,
  bucket: R2Bucket,
  now: number,
): Promise<number> {
  const pending = await db
    .select()
    .from(skillWrites)
    .where(eq(skillWrites.status, 'pending'))
    .orderBy(skillWrites.createdAt)
    .limit(20)
  for (const row of pending) await finishSkillWrite(db, bucket, row, now)
  return pending.length
}

/** Move a skill to another status, guarded by the revision the caller read. */
export async function setSkillStatus(
  db: MemoryDb,
  ctx: OperationContext,
  target: {
    scope: Scope
    name: string
    revision: number
    status: SkillStatus
    absorbedInto?: string
  },
): Promise<WriteResult> {
  const earlier = await appliedResult(db, ctx.opId)
  if (earlier !== undefined) return { ...earlier, replayed: true }
  const key = `${target.scope}/${target.name}`
  if (
    target.absorbedInto !== undefined &&
    !(target.status === 'archived' && target.scope.startsWith('agent:'))
  ) {
    throw new TypeError('Only an archived agent skill is absorbed into a shared one')
  }
  const current = await db
    .select({ revision: skills.revision })
    .from(skills)
    .where(and(eq(skills.scope, target.scope), eq(skills.name, target.name)))
    .get()
  if (current?.revision !== target.revision) {
    return { status: 'conflict', reason: 'target_changed', replayed: false }
  }
  const result: OperationResult = { status: 'applied', recordId: key }
  try {
    await db.batch([
      insertOp(db, ctx, 'skill_status', result),
      claimRevision(db, ctx, 'skill', key, target.revision + 1),
      db
        .update(skills)
        .set({
          status: target.status,
          absorbedInto: target.absorbedInto ?? null,
          revision: target.revision + 1,
          // `updated_at` dates the content, so curation counts from it; only a restore resets it.
          ...(target.status === 'active' ? { updatedAt: ctx.now } : {}),
        })
        .where(
          and(
            eq(skills.scope, target.scope),
            eq(skills.name, target.name),
            eq(skills.revision, target.revision),
          ),
        ),
      skillLedger(db, ctx, target.status, key, { absorbedInto: target.absorbedInto ?? null }),
      bumpScope(db, ctx, target.scope),
    ])
  } catch (error) {
    if (!/constraint/i.test(errorText(error))) throw error
    const applied = await appliedResult(db, ctx.opId)
    if (applied !== undefined) return { ...applied, replayed: true }
    return { status: 'conflict', reason: 'target_changed', replayed: false }
  }
  return { ...result, replayed: false }
}

/** Write a ledger row's before files back, as a new write against the current revision. */
export async function rollbackSkill(
  db: MemoryDb,
  bucket: R2Bucket,
  ctx: OperationContext,
  ledgerSeq: number,
): Promise<WriteResult> {
  const entry = await db.select().from(memoryLedger).where(eq(memoryLedger.seq, ledgerSeq)).get()
  if (entry?.target !== 'skill' || entry.action !== 'write' || entry.detailJson === null) {
    throw new TypeError(`Ledger row ${ledgerSeq} is not a skill write`)
  }
  const [scope, name] = splitKey(entry.targetId)
  const current = await db
    .select()
    .from(skills)
    .where(and(eq(skills.scope, scope), eq(skills.name, name)))
    .get()
  if (current === undefined) return { status: 'conflict', reason: 'missing_skill', replayed: false }
  const files: Record<string, string | null> = {}
  for (const change of v.parse(changesSchema, JSON.parse(entry.detailJson))) {
    if (change.before === null) {
      files[change.path] = null
      continue
    }
    const blob = await bucket.get(blobKey(change.before))
    if (blob === null) throw new Error(`Skill blob ${change.before} is missing`)
    files[change.path] = await blob.text()
  }
  return writeSkill(db, bucket, ctx, {
    scope,
    name,
    files,
    baseRevision: current.revision,
    status: 'active',
    evidence: `rollback of ledger row ${ledgerSeq}`,
    ...(current.basedOn === null ? {} : { basedOn: current.basedOn }),
  })
}

function isScope(value: string): value is Scope {
  return value.startsWith('agent:') || value.startsWith('shared:')
}

/** `<scope>/<name>` into its parts; scopes contain no `/`. */
export function splitKey(key: string): [Scope, string] {
  const index = key.lastIndexOf('/')
  const scope = key.slice(0, index)
  if (index < 0 || !isScope(scope)) throw new TypeError(`Invalid skill key: ${key}`)
  return [scope, key.slice(index + 1)]
}

/**
 * The skills an agent sees: its own, then shared ones whose name it does not use, the earlier
 * shared space winning. Agent skills first, then shared by this agent's uses and all agents' uses.
 */
export async function visibleSkills(
  db: MemoryDb,
  agentId: string,
  sharedSpaces: readonly string[],
): Promise<VisibleSkill[]> {
  const scopes = readableScopes(agentId, sharedSpaces)
  const rows = await db
    .select()
    .from(skills)
    .where(and(inArray(skills.scope, scopes), inArray(skills.status, ['active', 'stale'])))
  if (rows.length === 0) return []
  const usage = await db.select().from(skillUsage).where(inArray(skillUsage.scope, scopes))
  const uses = (skill: Skill, mine: boolean) =>
    usage
      .filter(
        (u) => u.scope === skill.scope && u.name === skill.name && (!mine || u.agentId === agentId),
      )
      .reduce((sum, u) => sum + u.useCount, 0)
  const own = scopes[0]
  const agentSkills = rows
    .filter((skill) => skill.scope === own)
    .sort((a, b) => uses(b, true) - uses(a, true))
  const taken = new Set(agentSkills.map((skill) => skill.name))
  const shared: Skill[] = []
  for (const scope of scopes.slice(1)) {
    for (const skill of rows.filter((row) => row.scope === scope)) {
      if (taken.has(skill.name)) continue
      taken.add(skill.name)
      shared.push(skill)
    }
  }
  shared.sort((a, b) => uses(b, true) - uses(a, true) || uses(b, false) - uses(a, false))
  return [...agentSkills, ...shared]
    .slice(0, SKILL_LIST_LIMIT)
    .map(({ scope, name, description }) => ({ scope, name, description }))
}

/** Count one use of a skill by an agent; a skill removed meanwhile is ignored. */
export async function recordSkillUse(
  db: MemoryDb,
  skill: { scope: Scope; name: string },
  agentId: string,
  now: number,
): Promise<void> {
  const key = and(
    eq(skillUsage.scope, skill.scope),
    eq(skillUsage.name, skill.name),
    eq(skillUsage.agentId, agentId),
  )
  try {
    // Only this agent writes its row; a use counted twice at the same moment may be lost.
    const current = await db.select().from(skillUsage).where(key).get()
    const useCount = (current?.useCount ?? 0) + 1
    await db
      .insert(skillUsage)
      .values({ scope: skill.scope, name: skill.name, agentId, useCount, lastUsedAt: now })
      .onConflictDoUpdate({
        target: [skillUsage.scope, skillUsage.name, skillUsage.agentId],
        set: { useCount, lastUsedAt: now },
      })
  } catch (error) {
    if (!/constraint/i.test(errorText(error))) throw error
  }
}

/**
 * Mark skills stale or archived after days without use (agent skills by their agent, shared
 * skills by anyone), and active again once used. Pinned skills are left alone.
 */
export async function curateSkills(db: MemoryDb, runId: string, now: number): Promise<number> {
  const rows = await db
    .select()
    .from(skills)
    .where(and(inArray(skills.status, ['active', 'stale']), eq(skills.pinned, false)))
  let changed = 0
  for (const skill of rows) {
    const agentId = skill.scope.startsWith('agent:')
      ? skill.scope.slice('agent:'.length)
      : undefined
    const usage = await db
      .select({ lastUsedAt: skillUsage.lastUsedAt })
      .from(skillUsage)
      .where(
        and(
          eq(skillUsage.scope, skill.scope),
          eq(skillUsage.name, skill.name),
          agentId === undefined ? undefined : eq(skillUsage.agentId, agentId),
        ),
      )
    const lastUse = Math.max(skill.updatedAt, ...usage.map((u) => u.lastUsedAt))
    const [staleDays, archiveDays] = SKILL_CURATION_DAYS[agentId === undefined ? 'shared' : 'agent']
    const idle = now - lastUse
    const status: SkillStatus =
      idle >= archiveDays * DAY_MS ? 'archived' : idle >= staleDays * DAY_MS ? 'stale' : 'active'
    if (status === skill.status) continue
    const result = await setSkillStatus(
      db,
      {
        opId: `curate:${skill.scope}/${skill.name}@${skill.revision}`,
        jobId: runId,
        runId,
        actor: 'consolidation',
        now,
      },
      { scope: skill.scope, name: skill.name, revision: skill.revision, status },
    )
    if (result.status === 'applied') changed++
  }
  return changed
}

/**
 * Delete blobs older than the grace period that no retained ledger row or pending write names.
 * Ledger rows outlive the rollback window by design, so a blob lives as long as its rollback can.
 */
export async function forgetSkillBlobs(
  db: MemoryDb,
  bucket: R2Bucket,
  now: number,
): Promise<number> {
  const referenced = new Set<string>()
  const ledger = await db
    .select({ detailJson: memoryLedger.detailJson })
    .from(memoryLedger)
    .where(and(eq(memoryLedger.target, 'skill'), eq(memoryLedger.action, 'write')))
  const pending = await db
    .select({ filesJson: skillWrites.filesJson })
    .from(skillWrites)
    .where(eq(skillWrites.status, 'pending'))
  for (const json of [
    ...ledger.map((row) => row.detailJson),
    ...pending.map((row) => row.filesJson),
  ]) {
    if (json === null) continue
    const parsed = v.safeParse(changesSchema, JSON.parse(json))
    if (!parsed.success) continue
    for (const change of parsed.output) {
      if (change.before !== null) referenced.add(change.before)
      if (change.after !== null) referenced.add(change.after)
    }
  }
  const page = await bucket.list({ prefix: blobKey(''), limit: 1000 })
  const stale = page.objects.filter(
    (object) =>
      !referenced.has(object.key.slice(blobKey('').length)) &&
      object.uploaded.getTime() < now - SKILL_BLOB_GRACE_MS,
  )
  if (stale.length > 0) await bucket.delete(stale.map((object) => object.key))
  return stale.length
}
