import { uuidv7 } from '../../lib/uuid.ts'
import { env } from 'cloudflare:workers'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { applyOperation } from './records.ts'
import { memoryDb } from './db.ts'
import type { NewRecord } from './records.ts'
import type { OperationContext } from './statements.ts'
import { memoryRecords, scopeRevisions } from '../../../drizzle/memory/schema.ts'
import type { Scope } from '../../../drizzle/memory/schema.ts'

const db = memoryDb(env.MEMORY_DB)
const NOW = Date.UTC(2026, 9, 1)

function agentScope(): { scope: Scope; agentId: string } {
  const agentId = uuidv7()
  return { scope: `agent:${agentId}`, agentId }
}

function context(opId: string, overrides: Partial<OperationContext> = {}): OperationContext {
  return { opId, jobId: 'job', runId: 'run', actor: 'test', now: NOW, ...overrides }
}

function fact(scope: Scope, agentId: string, content: string, entryTo: number): NewRecord {
  return {
    scope,
    kind: 'fact',
    content,
    origin: 'extraction',
    sourceAgentId: agentId,
    sourceEntries: { from: entryTo, to: entryTo },
    observedAt: NOW,
  }
}

async function activeContents(scope: Scope): Promise<string[]> {
  const rows = await db
    .select({ content: memoryRecords.content })
    .from(memoryRecords)
    .where(and(eq(memoryRecords.scope, scope), eq(memoryRecords.status, 'active')))
  return rows.map((row) => row.content)
}

async function revision(id: string): Promise<number | undefined> {
  const row = await db
    .select({ revision: memoryRecords.revision })
    .from(memoryRecords)
    .where(eq(memoryRecords.id, id))
    .get()
  return row?.revision
}

async function written(scope: Scope, agentId: string, content: string, entry: number) {
  const result = await applyOperation(db, context(uuidv7()), {
    type: 'write',
    record: fact(scope, agentId, content, entry),
  })
  if (result.status !== 'applied') throw new Error(`write failed: ${result.status}`)
  return result.recordId
}

describe('applying operations', () => {
  it('redacts credential-shaped text before a memory record is stored', async () => {
    const { scope, agentId } = agentScope()
    await written(scope, agentId, 'Key sk-private123456 and xai-private123456', 1)
    expect(await activeContents(scope)).toEqual(['Key [REDACTED] and [REDACTED]'])
  })

  it('applies the same supersede once when it is repeated', async () => {
    const { scope, agentId } = agentScope()
    const oldId = await written(scope, agentId, 'uses npm', 100)
    const op = {
      type: 'supersede',
      oldId,
      oldRevision: 1,
      record: fact(scope, agentId, 'uses pnpm', 150),
    } as const

    const first = await applyOperation(db, context('op-supersede'), op)
    const repeat = await applyOperation(db, context('op-supersede'), op)

    expect(first).toMatchObject({ status: 'applied', replayed: false })
    expect(repeat).toEqual({ ...first, replayed: true })
    expect(await activeContents(scope)).toEqual(['uses pnpm'])
  })

  it('returns conflict and changes nothing when the target revision is outdated', async () => {
    const { scope, agentId } = agentScope()
    const oldId = await written(scope, agentId, 'uses npm', 100)
    await applyOperation(db, context(uuidv7()), {
      type: 'supersede',
      oldId,
      oldRevision: 1,
      record: fact(scope, agentId, 'uses pnpm', 150),
    })

    const late = await applyOperation(db, context(uuidv7()), {
      type: 'supersede',
      oldId,
      oldRevision: 1,
      record: fact(scope, agentId, 'uses yarn', 160),
    })

    expect(late).toEqual({ status: 'conflict', reason: 'target_changed', replayed: false })
    expect(await activeContents(scope)).toEqual(['uses pnpm'])
  })

  it('rolls the batch back when the target changes after the precondition read', async () => {
    const { scope, agentId } = agentScope()
    const oldId = await written(scope, agentId, 'uses npm', 100)

    const result = await applyOperation(
      db,
      context(uuidv7(), {
        // Another writer supersedes the record between the read and the batch.
        beforeBatch: async () => {
          await applyOperation(db, context(uuidv7()), {
            type: 'supersede',
            oldId,
            oldRevision: 1,
            record: fact(scope, agentId, 'uses yarn', 140),
          })
        },
      }),
      { type: 'supersede', oldId, oldRevision: 1, record: fact(scope, agentId, 'uses pnpm', 150) },
    )

    expect(result).toEqual({ status: 'conflict', reason: 'changed_during_write', replayed: false })
    expect(await activeContents(scope)).toEqual(['uses yarn'])
    expect(await revision(oldId)).toBe(2)
  })

  it('declines a candidate built on older entries than the record it would replace', async () => {
    const { scope, agentId } = agentScope()
    const correction = await written(scope, agentId, 'uses pnpm', 150)

    const oldExtraction = await applyOperation(db, context(uuidv7()), {
      type: 'supersede',
      oldId: correction,
      oldRevision: 1,
      record: fact(scope, agentId, 'uses npm', 100),
    })

    expect(oldExtraction).toMatchObject({ status: 'stale' })
    expect(await activeContents(scope)).toEqual(['uses pnpm'])
  })

  it('does not let one agent supersede the record of another', async () => {
    const { scope, agentId } = agentScope()
    const oldId = await written(scope, agentId, 'uses npm', 100)

    const result = await applyOperation(db, context(uuidv7()), {
      type: 'supersede',
      oldId,
      oldRevision: 1,
      record: fact(scope, 'other-agent', 'uses pnpm', 150),
    })

    expect(result).toMatchObject({ status: 'conflict', reason: 'other_agent' })
    expect(await activeContents(scope)).toEqual(['uses npm'])
  })

  it('reports a second write of the same content from the same source as a duplicate', async () => {
    const { scope, agentId } = agentScope()
    await written(scope, agentId, 'uses pnpm', 150)

    const again = await applyOperation(db, context(uuidv7()), {
      type: 'write',
      record: fact(scope, agentId, 'uses pnpm', 150),
    })

    expect(again).toEqual({ status: 'conflict', reason: 'duplicate', replayed: false })
  })

  it('changes the scope revision for facts but not for events', async () => {
    const { scope, agentId } = agentScope()
    const current = async () =>
      (
        await db
          .select({ revision: scopeRevisions.revision })
          .from(scopeRevisions)
          .where(eq(scopeRevisions.scope, scope))
          .get()
      )?.revision

    await applyOperation(db, context(uuidv7()), {
      type: 'write',
      record: { ...fact(scope, agentId, 'deployed on Friday', 10), kind: 'event' },
    })
    expect(await current()).toBeUndefined()
    await written(scope, agentId, 'uses pnpm', 20)
    const first = await current()
    await written(scope, agentId, 'uses vitest', 30)
    expect(first).toBeDefined()
    expect(await current()).not.toBe(first)
  })
})

describe('checking operations', () => {
  it.each([
    ['empty content', { content: '' }, /1–2000 characters/],
    ['content over 2,000 characters', { content: 'x'.repeat(2_001) }, /1–2000 characters/],
    ['importance above 1', { importance: 1.5 }, /importance/],
    ['an override from a shared record', { scope: 'shared:global', overrides: 'x' }, /overrides/],
    ['a required agent record', { required: true }, /required/],
    [
      'a required shared event',
      { scope: 'shared:global', kind: 'event', required: true },
      /required/,
    ],
  ] as const)('refuses a write with %s', async (_case, change, message) => {
    const { scope, agentId } = agentScope()
    await expect(
      applyOperation(db, context(uuidv7()), {
        type: 'write',
        record: { ...fact(scope, agentId, 'uses pnpm', 1), ...change },
      }),
    ).rejects.toThrow(message)
  })

  it('does not supersede a record of another scope', async () => {
    const { scope, agentId } = agentScope()
    const oldId = await written(scope, agentId, 'uses npm', 100)

    const result = await applyOperation(db, context(uuidv7()), {
      type: 'supersede',
      oldId,
      oldRevision: 1,
      record: fact(agentScope().scope, agentId, 'uses pnpm', 150),
    })

    expect(result).toMatchObject({ status: 'conflict', reason: 'other_scope' })
  })

  it('keeps the evidence of the record a consolidation rewrites', async () => {
    const { scope, agentId } = agentScope()
    const oldId = await written(scope, agentId, 'uses npm and pnpm', 120)
    const { sourceEntries: _evidence, ...rewrite } = fact(scope, agentId, 'uses pnpm', 0)

    const result = await applyOperation(db, context(uuidv7()), {
      type: 'supersede',
      oldId,
      oldRevision: 1,
      record: { ...rewrite, origin: 'consolidation' },
    })

    if (result.status !== 'applied') throw new Error(`supersede ${result.status}`)
    const row = await db
      .select()
      .from(memoryRecords)
      .where(eq(memoryRecords.id, result.recordId))
      .get()
    expect(row).toMatchObject({ sourceEntryFrom: 120, sourceEntryTo: 120, content: 'uses pnpm' })
  })

  it('does not invalidate a record at a revision that is no longer current', async () => {
    const { scope, agentId } = agentScope()
    const id = await written(scope, agentId, 'uses npm', 100)

    const result = await applyOperation(db, context(uuidv7()), {
      type: 'invalidate',
      id,
      revision: 2,
      reason: 'No longer true',
      evidence: {
        scope,
        sourceAgentId: agentId,
        origin: 'extraction',
        sourceEntries: { from: 200, to: 200 },
      },
    })

    expect(result).toMatchObject({ status: 'conflict', reason: 'target_changed' })
    expect(await revision(id)).toBe(1)
  })
})
