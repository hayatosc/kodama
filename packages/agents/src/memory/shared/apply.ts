/** Applying accepted proposals exactly as they were checked, in code (Proposals). */
import { and, eq, inArray } from 'drizzle-orm'
import * as v from 'valibot'
import type { JobOutcome } from '../memory-agent/jobs.ts'
import { blobKey, splitKey } from '../skills/paths.ts'
import { setSkillStatus, writeSkill } from '../skills/write.ts'
import type { MemoryDb } from '../store/db.ts'
import { applyOperation } from '../store/records.ts'
import { memoryLedger, sharedProposals, skills, skillUsage } from '../store/schema.ts'
import type { Scope } from '../store/schema.ts'
import type { OperationContext } from '../store/statements.ts'
import { proposalPayloadSchema, SHARED_SOURCE_AGENT, sharedScope } from './proposals.ts'
import type { Proposal } from './proposals.ts'

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
      const shared = await db
        .select()
        .from(skillUsage)
        .where(
          and(
            eq(skillUsage.scope, scope),
            eq(skillUsage.name, name),
            eq(skillUsage.agentId, use.agentId),
          ),
        )
        .get()
      const merged = {
        useCount: (shared?.useCount ?? 0) + use.useCount,
        lastUsedAt: Math.max(shared?.lastUsedAt ?? 0, use.lastUsedAt),
      }
      await db
        .insert(skillUsage)
        .values({ scope, name, agentId: use.agentId, ...merged })
        .onConflictDoUpdate({
          target: [skillUsage.scope, skillUsage.name, skillUsage.agentId],
          set: merged,
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
