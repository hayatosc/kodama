/**
 * Shared memory through proposals (docs/design/long-term-memory.md, Proposals, Shared memory).
 * The memory agent proposes, code checks the proposal at once with no person in the loop, and the
 * memory agent applies an accepted proposal exactly as written, in code.
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import * as v from 'valibot'
import type { JobOutcome } from './jobs.ts'
import { looksLikeInjection } from './redact.ts'
import { applyOperation } from './records.ts'
import type { MemoryDb, OperationContext, Scope } from './records.ts'
import { memoryLedger, memoryRecords, sharedProposals, skills, skillUsage } from './schema.ts'
import { blobKey, isSkillName, setSkillStatus, skillDir, splitKey, writeSkill } from './skills.ts'

/** Records written by applied proposals belong to no single agent. */
export const SHARED_SOURCE_AGENT = 'memory'
export const SPACE_PATTERN = /^[a-z0-9-]{1,64}$/

/** Agents whose own records or skills must back a proposal that brings something into a space. */
export const MIN_SOURCE_AGENTS = 2
/** Names the rules that decided, so a later change to them is visible in old rows. */
const CHECKS = 'checks:1'

export type Proposal = typeof sharedProposals.$inferSelect

const KIND = v.picklist(['fact', 'instruction', 'event', 'task'])
const recordPayloadSchema = v.object({
  type: v.literal('record'),
  kind: KIND,
  content: v.pipe(v.string(), v.minLength(1), v.maxLength(2_000)),
  importance: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(1))),
  required: v.optional(v.boolean()),
  /** The shared record this one replaces, at `base_revision`. */
  replaces: v.optional(v.string()),
})
const skillPayloadSchema = v.object({
  type: v.literal('skill'),
  name: v.pipe(v.string(), v.check(isSkillName, 'Invalid skill name')),
  /** Files already stored as blobs, so what is applied is what was checked. */
  files: v.array(v.object({ path: v.string(), sha256: v.string() })),
  remove: v.array(v.string()),
})
export const proposalPayloadSchema = v.variant('type', [recordPayloadSchema, skillPayloadSchema])
export type ProposalPayload = v.InferOutput<typeof proposalPayloadSchema>

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function sharedScope(space: string): Scope {
  if (!SPACE_PATTERN.test(space)) throw new TypeError(`Invalid shared space: ${space}`)
  return `shared:${space}`
}

export interface ProposalInput {
  space: string
  payload: ProposalPayload
  /** Agent records or `agent:<id>/<name>` skills the proposal rests on. */
  sourceIds: readonly string[]
}

/**
 * Why a proposal may not change the shared scope, or undefined when it may. Bringing something
 * into a space needs records or skills of at least `MIN_SOURCE_AGENTS` agents; reorganizing a
 * space needs sources that are all active records of that space.
 */
async function rejection(
  db: MemoryDb,
  scope: Scope,
  payload: ProposalPayload,
  sourceIds: readonly string[],
): Promise<string | undefined> {
  if (payload.type === 'skill') {
    const agents = new Set<string>()
    for (const source of sourceIds) {
      if (!source.startsWith('agent:')) continue
      const [sourceScope, name] = splitKey(source)
      const skill = await db
        .select({ status: skills.status })
        .from(skills)
        .where(and(eq(skills.scope, sourceScope), eq(skills.name, name)))
        .get()
      if (skill?.status === 'active' || skill?.status === 'stale') agents.add(sourceScope)
    }
    return agents.size >= MIN_SOURCE_AGENTS
      ? undefined
      : `a shared skill needs the same procedure as a skill of ${MIN_SOURCE_AGENTS} agents`
  }
  if (looksLikeInjection(payload.content)) return 'the content reads as instructions to obey'
  const sources =
    sourceIds.length === 0
      ? []
      : await db
          .select()
          .from(memoryRecords)
          .where(and(inArray(memoryRecords.id, [...sourceIds]), eq(memoryRecords.status, 'active')))
  if (sources.length !== sourceIds.length) return 'every source must be an active record'
  const agents = new Set(sources.filter((r) => r.scope.startsWith('agent:')).map((r) => r.scope))
  const reorganizes = sources.length > 0 && sources.every((record) => record.scope === scope)
  if (agents.size < MIN_SOURCE_AGENTS && !reorganizes) {
    return `a shared record needs records of ${MIN_SOURCE_AGENTS} agents, or only records of ${scope}`
  }
  if (payload.required === true && agents.size < MIN_SOURCE_AGENTS) {
    const inherited = sources.every((record) => record.required)
    if (!inherited) return `a required record needs records of ${MIN_SOURCE_AGENTS} agents`
  }
  return undefined
}

/**
 * Store a proposal, accepted or rejected by the checks; the same operation stores it once. The
 * target and its revision are read now, so a later change to the target makes it a conflict.
 */
export async function propose(
  db: MemoryDb,
  ctx: OperationContext,
  input: ProposalInput,
): Promise<Proposal> {
  const scope = sharedScope(input.space)
  const payload = v.parse(proposalPayloadSchema, input.payload)
  let targetKey: string = scope
  let baseRevision: number | null = null
  if (payload.type === 'record' && payload.replaces !== undefined) {
    const target = await db
      .select()
      .from(memoryRecords)
      .where(eq(memoryRecords.id, payload.replaces))
      .get()
    if (target?.scope !== scope || target.status !== 'active') {
      throw new TypeError(`No active record ${payload.replaces} in ${scope}`)
    }
    targetKey = target.id
    baseRevision = target.revision
  }
  if (payload.type === 'skill') {
    targetKey = `${scope}/${payload.name}`
    const target = await db
      .select({ revision: skills.revision })
      .from(skills)
      .where(and(eq(skills.scope, scope), eq(skills.name, payload.name)))
      .get()
    baseRevision = target?.revision ?? null
  }
  const id = await sha256(`proposal:${ctx.opId}`)
  const reason = await rejection(db, scope, payload, input.sourceIds)
  const status = reason === undefined ? 'accepted' : 'rejected'
  await db.batch([
    db
      .insert(sharedProposals)
      .values({
        id,
        space: input.space,
        target: payload.type,
        targetKey,
        baseRevision,
        payloadJson: JSON.stringify(payload),
        sourceIdsJson: JSON.stringify(input.sourceIds),
        status,
        runId: ctx.runId,
        proposedAt: ctx.now,
        decidedBy: CHECKS,
        reason: reason ?? null,
      })
      .onConflictDoNothing(),
    db.insert(memoryLedger).values({
      at: ctx.now,
      runId: ctx.runId,
      opId: ctx.opId,
      actor: ctx.actor,
      action: status === 'accepted' ? 'propose' : 'propose_rejected',
      target: 'proposal',
      targetId: id,
      detailJson: JSON.stringify({ space: input.space, targetKey, reason }),
    }),
  ])
  const stored = await db.select().from(sharedProposals).where(eq(sharedProposals.id, id)).get()
  if (stored === undefined) throw new Error(`Proposal ${id} was not stored`)
  return stored
}

/** Accepted proposals not yet applied, oldest first: the durable pending work. */
export function acceptedProposals(db: MemoryDb, limit = 50): Promise<Proposal[]> {
  return db
    .select()
    .from(sharedProposals)
    .where(eq(sharedProposals.status, 'accepted'))
    .orderBy(sharedProposals.proposedAt)
    .limit(limit)
}

async function settleProposal(
  db: MemoryDb,
  proposal: Proposal,
  status: 'applied' | 'conflict',
  reason: string | undefined,
  now: number,
): Promise<void> {
  await db
    .update(sharedProposals)
    .set({
      status,
      ...(status === 'applied' ? { appliedAt: now } : { reason: reason ?? 'conflict' }),
    })
    .where(and(eq(sharedProposals.id, proposal.id), eq(sharedProposals.status, 'accepted')))
}

export interface ApplyDeps {
  db: MemoryDb
  bucket: R2Bucket
  /** The shared spaces an agent reads, to resolve which skill a name loads for it. */
  sharedSpacesOf: (agentId: string) => Promise<readonly string[]>
  now: number
}

/**
 * Apply an accepted proposal with the proposal ID as operation ID, so a repeat changes nothing.
 * A target that changed since the proposal was written makes it a conflict.
 */
export async function applyProposal(deps: ApplyDeps, id: string): Promise<JobOutcome> {
  const { db, now } = deps
  const proposal = await db.select().from(sharedProposals).where(eq(sharedProposals.id, id)).get()
  if (proposal === undefined) return 'declined'
  if (proposal.status === 'applied') return 'persisted'
  if (proposal.status === 'conflict') return 'conflict'
  if (proposal.status !== 'accepted') return 'declined'
  const ctx: OperationContext = {
    opId: `apply:${id}`,
    jobId: `apply:${id}`,
    runId: `apply:${id}`,
    actor: 'memory-agent',
    now,
  }
  const scope = sharedScope(proposal.space)
  const payload = v.parse(proposalPayloadSchema, JSON.parse(proposal.payloadJson))

  if (payload.type === 'record') {
    const record = {
      scope,
      kind: payload.kind,
      content: payload.content,
      origin: 'proposal' as const,
      sourceAgentId: SHARED_SOURCE_AGENT,
      ...(payload.importance === undefined ? {} : { importance: payload.importance }),
      ...(payload.required === undefined ? {} : { required: payload.required }),
      observedAt: now,
    }
    const result = await applyOperation(
      db,
      ctx,
      payload.replaces === undefined || proposal.baseRevision === null
        ? { type: 'write', record }
        : {
            type: 'supersede',
            oldId: payload.replaces,
            oldRevision: proposal.baseRevision,
            record,
          },
    )
    if (result.status !== 'applied') {
      await settleProposal(db, proposal, 'conflict', result.status, now)
      return 'conflict'
    }
    await settleProposal(db, proposal, 'applied', undefined, now)
    return 'persisted'
  }

  const files: Record<string, string | null> = {}
  for (const file of payload.files) {
    const blob = await deps.bucket.get(blobKey(file.sha256))
    if (blob === null) throw new Error(`Proposal blob ${file.sha256} is missing`)
    files[file.path] = await blob.text()
  }
  for (const path of payload.remove) files[path] = null
  const result = await writeSkill(db, deps.bucket, ctx, {
    scope,
    name: payload.name,
    files,
    baseRevision: proposal.baseRevision ?? undefined,
    status: 'active',
    evidence: proposal.sourceIdsJson,
  })
  if (result.status !== 'applied') {
    await settleProposal(
      db,
      proposal,
      'conflict',
      result.status === 'conflict' ? result.reason : undefined,
      now,
    )
    return 'conflict'
  }
  await absorbSources(deps, ctx, scope, payload.name, proposal)
  await settleProposal(db, proposal, 'applied', undefined, now)
  return 'persisted'
}

/**
 * Move the source skills' uses to the shared skill, then archive each source whose agent now
 * resolves the name to the shared skill. A source that would still shadow it, or whose agent does
 * not read the space, is kept, with the reason in the ledger.
 */
async function absorbSources(
  deps: ApplyDeps,
  ctx: OperationContext,
  scope: Scope,
  name: string,
  proposal: Proposal,
): Promise<void> {
  const { db } = deps
  const sources = v.parse(v.array(v.string()), JSON.parse(proposal.sourceIdsJson))
  for (const source of sources) {
    if (!source.startsWith('agent:')) continue
    const [sourceScope, sourceName] = splitKey(source)
    const agentId = sourceScope.slice('agent:'.length)
    const skill = await db
      .select()
      .from(skills)
      .where(and(eq(skills.scope, sourceScope), eq(skills.name, sourceName)))
      .get()
    if (skill === undefined || skill.status === 'archived') continue
    const usage = await db
      .select()
      .from(skillUsage)
      .where(and(eq(skillUsage.scope, sourceScope), eq(skillUsage.name, sourceName)))
    for (const use of usage) {
      await db
        .insert(skillUsage)
        .values({
          scope,
          name,
          agentId: use.agentId,
          useCount: use.useCount,
          lastUsedAt: use.lastUsedAt,
        })
        .onConflictDoUpdate({
          target: [skillUsage.scope, skillUsage.name, skillUsage.agentId],
          set: { useCount: sql`${skillUsage.useCount} + ${use.useCount}` },
        })
    }
    // Resolve the name as the agent would once the source is gone: its own skill of that name
    // first, then the earliest of its shared spaces that has one.
    const spaces = await deps.sharedSpacesOf(agentId)
    const live = inArray(skills.status, ['active', 'stale'])
    const ownOther =
      sourceName !== name &&
      (await db
        .select({ name: skills.name })
        .from(skills)
        .where(and(eq(skills.scope, sourceScope), eq(skills.name, name), live))
        .get()) !== undefined
    const spaceScopes = spaces.map((space): Scope => `shared:${space}`)
    const sharedRows =
      spaceScopes.length === 0
        ? []
        : await db
            .select({ scope: skills.scope })
            .from(skills)
            .where(and(inArray(skills.scope, spaceScopes), eq(skills.name, name), live))
    const first = spaceScopes.find((space) => sharedRows.some((row) => row.scope === space))
    const resolves = !ownOther && first === scope
    if (!resolves) {
      await db.insert(memoryLedger).values({
        at: ctx.now,
        runId: ctx.runId,
        opId: ctx.opId,
        actor: ctx.actor,
        action: 'keep_source',
        target: 'skill',
        targetId: source,
        detailJson: JSON.stringify({
          reason: spaces.includes(scope.slice('shared:'.length))
            ? 'another skill would load under this name'
            : 'the agent does not read the space',
        }),
      })
      continue
    }
    await setSkillStatus(
      db,
      { ...ctx, opId: `${ctx.opId}:absorb:${source}` },
      {
        scope: sourceScope,
        name: sourceName,
        revision: skill.revision,
        status: 'archived',
        absorbedInto: `${scope}/${name}`,
      },
    )
  }
}

/** Store an agent skill's current files as blobs, for a skill proposal's payload. */
export async function skillFilesAsBlobs(
  bucket: R2Bucket,
  scope: Scope,
  name: string,
): Promise<{ path: string; sha256: string }[]> {
  const dir = skillDir(scope, name)
  const files: { path: string; sha256: string }[] = []
  const page = await bucket.list({ prefix: dir })
  for (const object of page.objects) {
    const body = await bucket.get(object.key)
    if (body === null) continue
    const bytes = await body.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
    if ((await bucket.head(blobKey(hash))) === null)
      await bucket.put(blobKey(hash), bytes, { sha256: hash })
    files.push({ path: object.key.slice(dir.length), sha256: hash })
  }
  return files
}
