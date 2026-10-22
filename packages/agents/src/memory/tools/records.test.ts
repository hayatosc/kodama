/**
 * Invalidation through the memory agent's tools respects job ownership and evidence freshness.
 *
 * @module
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { context, db, memoryAgent, record, write } from '../../helper/memory.ts'
import { applyOperation } from '../store/records.ts'
import { requestBody, textResponse, toolCallResponse, toolResults } from '../../helper/model.ts'
import type { MemoryJob } from '../jobs.ts'
import '@earendil-works/pi-ai/api/openai-responses'

afterEach(() => vi.restoreAllMocks())

async function invalidate(job: MemoryJob, id: string, sourceEntryFrom = 200) {
  const responses: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    const body = requestBody(init)
    if (toolResults(body) === 0) {
      return toolCallResponse({
        name: 'memory_invalidate',
        arguments: { id, revision: 1, reason: 'No longer true', sourceEntryFrom },
      })
    }
    responses.push(body)
    return textResponse('Finished.')
  })
  const queued = await memoryAgent().enqueue(job)
  await expect
    .poll(async () => (await memoryAgent().jobStatus(queued.jobId))?.status, { timeout: 10_000 })
    .toBe('settled')
  return responses.join('\n')
}

function job(kind: 'remember' | 'extract', sourceAgentId: string): MemoryJob {
  return kind === 'remember'
    ? {
        kind,
        sourceAgentId,
        origin: 'user_request',
        content: 'Forget the old instruction',
        sourceEntries: { from: 100, to: 100 },
      }
    : { kind, sourceAgentId, afterEntry: 0 }
}

describe('memory_invalidate', () => {
  it.each(['remember', 'extract'] as const)(
    'does not let a %s job invalidate a required shared record',
    async (kind) => {
      const id = await write({
        scope: 'shared:global',
        kind: 'instruction',
        content: `Required rule ${crypto.randomUUID()}`,
        required: true,
        sourceAgentId: 'memory',
      })
      const response = await invalidate(job(kind, crypto.randomUUID()), id)
      expect((await record(id))?.status).toBe('active')
      expect(response).toContain('other_scope')
    },
  )

  it.each(['remember', 'extract'] as const)(
    "does not let a %s job invalidate another agent's record",
    async (kind) => {
      const owner = crypto.randomUUID()
      const id = await write({
        scope: `agent:${owner}`,
        kind: 'fact',
        content: 'Uses pnpm',
        sourceAgentId: owner,
        sourceEntries: { from: 50, to: 50 },
      })
      const response = await invalidate(job(kind, crypto.randomUUID()), id)
      expect((await record(id))?.status).toBe('active')
      expect(response).toContain('other_scope')
    },
  )

  it.each(['remember', 'extract'] as const)(
    'declines a %s invalidation older than the record',
    async (kind) => {
      const owner = crypto.randomUUID()
      const id = await write({
        scope: `agent:${owner}`,
        kind: 'fact',
        content: 'Uses pnpm',
        sourceAgentId: owner,
        sourceEntries: { from: 150, to: 150 },
      })
      // A remember job must use its own evidence, not the model's newer citation.
      const response = await invalidate(job(kind, owner), id, kind === 'remember' ? 200 : 100)
      expect((await record(id))?.status).toBe('active')
      expect(response).toContain('stale:')
    },
  )

  it('does not invalidate a same-scope record attributed to a different source agent', async () => {
    const owner = crypto.randomUUID()
    const id = await write({
      scope: `agent:${owner}`,
      kind: 'fact',
      content: 'Uses pnpm',
      sourceAgentId: crypto.randomUUID(),
      sourceEntries: { from: 50, to: 50 },
    })
    const response = await invalidate(job('extract', owner), id)
    expect((await record(id))?.status).toBe('active')
    expect(response).toContain('other_agent')
  })

  it('requires strictly newer evidence, not the same entry', async () => {
    const owner = crypto.randomUUID()
    const id = await write({
      scope: `agent:${owner}`,
      kind: 'fact',
      content: 'Uses pnpm',
      sourceAgentId: owner,
      sourceEntries: { from: 150, to: 150 },
    })
    const response = await invalidate(job('extract', owner), id, 150)
    expect((await record(id))?.status).toBe('active')
    expect(response).toContain('stale:')
  })

  it('applies newer extraction evidence', async () => {
    const owner = crypto.randomUUID()
    const id = await write({
      scope: `agent:${owner}`,
      kind: 'fact',
      content: 'Uses pnpm',
      sourceAgentId: owner,
      sourceEntries: { from: 150, to: 150 },
    })
    const response = await invalidate(job('extract', owner), id, 200)
    expect((await record(id))?.status).toBe('invalid')
    expect(response).toContain(`applied ${id}`)
  })

  it('replays an accepted invalidation without changing the record again', async () => {
    const owner = crypto.randomUUID()
    const id = await write({
      scope: `agent:${owner}`,
      kind: 'fact',
      content: 'Uses pnpm',
      sourceAgentId: owner,
      sourceEntries: { from: 150, to: 150 },
    })
    const operation = {
      type: 'invalidate',
      id,
      revision: 1,
      reason: 'No longer true',
      evidence: {
        scope: `agent:${owner}`,
        sourceAgentId: owner,
        origin: 'extraction',
        sourceEntries: { from: 200, to: 200 },
      },
    } as const
    const run = context()
    expect(await applyOperation(db, run, operation)).toEqual({
      status: 'applied',
      recordId: id,
      replayed: false,
    })
    expect(await applyOperation(db, run, operation)).toEqual({
      status: 'applied',
      recordId: id,
      replayed: true,
    })
    expect(await record(id)).toMatchObject({ status: 'invalid', revision: 2 })
  })

  it('allows consolidation of its own scope without claiming newer evidence', async () => {
    const owner = crypto.randomUUID()
    const id = await write({
      scope: `agent:${owner}`,
      kind: 'fact',
      content: 'Uses pnpm',
      sourceAgentId: owner,
      sourceEntries: { from: 150, to: 150 },
    })
    const response = await invalidate(
      { kind: 'consolidate', scope: `agent:${owner}`, day: '2026-10-01' },
      id,
    )
    expect((await record(id))?.status).toBe('invalid')
    expect(response).toContain(`applied ${id}`)
  })
})
