/**
 * Invalidation through the memory agent's tools respects job ownership and evidence freshness.
 *
 * @module
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runInDurableObject } from 'cloudflare:test'
import { jobId } from '../../memory/jobs.ts'
import { EXTRACTION_READ_KEY } from '../../storage/memory.ts'
import { context, db, memoryAgent, record, runScriptedJob, write } from '../../helper/memory.ts'
import { applyOperation } from '../../memory/store/records.ts'
import { requestBody, textResponse, toolCallResponse, toolResults } from '../../helper/model.ts'
import type { MemoryJob } from '../../memory/jobs.ts'
import '@earendil-works/pi-ai/api/openai-responses'

afterEach(() => vi.restoreAllMocks())

async function invalidate(job: MemoryJob, id: string, sourceEntryFrom = 200) {
  if (job.kind === 'extract') {
    // These ownership/freshness fixtures model an already-read page through entry 200.
    const id = await jobId(job)
    await runInDurableObject(memoryAgent(), (_instance, state) =>
      state.storage.put(EXTRACTION_READ_KEY, { jobId: id, through: 200 }),
    )
  }
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

describe('consolidation tools', () => {
  const day = '2026-10-02'
  const remember = (sourceAgentId: string): MemoryJob => ({
    kind: 'remember',
    sourceAgentId,
    origin: 'user_request',
    content: 'Tidy the shared rules',
    sourceEntries: { from: 1, to: 1 },
  })

  it('lists the active records of the scope with their flags', async () => {
    const owner = crypto.randomUUID()
    const shared = await write({
      scope: 'shared:global',
      kind: 'instruction',
      content: `Shared rule ${owner}`,
      sourceAgentId: 'memory',
    })
    const id = await write({
      scope: `agent:${owner}`,
      kind: 'instruction',
      content: 'Answer in English',
      sourceAgentId: owner,
      overrides: shared,
    })
    const empty = crypto.randomUUID()

    const listed = await runScriptedJob({ kind: 'consolidate', scope: `agent:${owner}`, day }, [
      { name: 'list_records', arguments: {} },
    ])
    const none = await runScriptedJob({ kind: 'consolidate', scope: `agent:${empty}`, day }, [
      { name: 'list_records', arguments: {} },
    ])

    expect(listed.outputs[0]).toMatch(
      new RegExp(
        `^- id=${id} revision=1 kind=instruction .* overrides=${shared}: Answer in English$`,
      ),
    )
    expect(none.outputs[0]).toBe('No active records.')
  })

  it('refuses list_records and shared_write outside a consolidate job', async () => {
    const { outputs } = await runScriptedJob(remember(crypto.randomUUID()), [
      { name: 'list_records', arguments: {} },
      {
        name: 'shared_write',
        arguments: { space: 'team', kind: 'fact', content: 'Uses pnpm', sourceIds: ['x'] },
      },
    ])

    expect(outputs[0]).toContain('list_records needs a consolidate job')
    expect(outputs[1]).toContain('shared_write needs a consolidate job')
  })

  it('applies a shared write that rests on two agents and rejects one that does not', async () => {
    const space = `team-${crypto.randomUUID().slice(0, 8)}`
    const [first, second] = [crypto.randomUUID(), crypto.randomUUID()]
    const sourceIds = await Promise.all(
      [first, second].map((agentId) =>
        write({
          scope: `agent:${agentId}`,
          kind: 'fact',
          content: 'Uses pnpm',
          sourceAgentId: agentId,
        }),
      ),
    )
    const shared = { space, kind: 'fact', content: 'The team uses pnpm' }

    const { outputs } = await runScriptedJob(
      { kind: 'consolidate', scope: `shared:${space}`, day },
      [
        { name: 'shared_write', arguments: { ...shared, sourceIds } },
        { name: 'shared_write', arguments: { ...shared, sourceIds: sourceIds.slice(0, 1) } },
        { name: 'memory_write', arguments: { kind: 'fact', content: 'Direct shared write' } },
      ],
    )

    expect(outputs[0]).toMatch(/^applied /)
    expect(outputs[1]).toBe(
      `rejected: a shared record needs records of 2 agents, or only records of shared:${space}`,
    )
    expect(outputs[2]).toContain('Shared records change only through shared_write')
  })
})
