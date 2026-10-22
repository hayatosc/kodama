import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyOperation } from './store/records.ts'
import { memoryLedger } from '../../drizzle/d1/schema.ts'
import { requestBody, textResponse, toolCallResponse, toolResults } from '../helper/model.ts'
import { activeContents, db, memoryAgent } from '../helper/memory.ts'
// Load the provider before RPC calls so Vite's module fetch is outside a short-lived DO request.
import '@earendil-works/pi-ai/api/openai-responses'

afterEach(() => vi.restoreAllMocks())

describe('consolidation', () => {
  it('merges duplicates of a changed scope and drops ledger rows past the rollback window', async () => {
    const agentId = crypto.randomUUID()
    const now = Date.now()
    for (const content of ['The CI runs on Linux', 'CI runs on Linux machines']) {
      await applyOperation(
        db,
        { opId: crypto.randomUUID(), jobId: 'seed', runId: 'seed', actor: 'test', now },
        {
          type: 'write',
          record: {
            scope: `agent:${agentId}`,
            kind: 'fact',
            content,
            origin: 'agent_judgment',
            sourceAgentId: agentId,
            sourceEntries: { from: 1, to: 1 },
            observedAt: now,
          },
        },
      )
    }
    await db.insert(memoryLedger).values({
      at: 0,
      runId: 'ancient',
      actor: 'test',
      action: 'write',
      target: 'record',
      targetId: agentId,
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = requestBody(init)
      const step = toolResults(body)
      if (!body.includes(`Job: consolidate scope agent:${agentId}`)) {
        return step === 0
          ? toolCallResponse({ name: 'memory_decline', arguments: { reason: 'test' } })
          : textResponse('Declined.')
      }
      if (step === 0) return toolCallResponse({ name: 'list_records', arguments: {} })
      if (step === 1) {
        const duplicate = /id=(\S+) revision=(\d+) kind=fact[^\n]*: CI runs on Linux machines/.exec(
          body.replaceAll('\\n', '\n'),
        )
        return toolCallResponse({
          name: 'memory_invalidate',
          arguments: {
            id: duplicate?.[1] ?? '',
            revision: Number(duplicate?.[2]),
            reason: 'duplicate',
          },
        })
      }
      return textResponse('Consolidated.')
    })

    const result = await memoryAgent().consolidate(now)

    expect(result.scopes).toBeGreaterThanOrEqual(1)
    await expect
      .poll(() => activeContents(agentId), { timeout: 10_000 })
      .toEqual(['The CI runs on Linux'])
    const ancient = await db.select().from(memoryLedger).where(eq(memoryLedger.runId, 'ancient'))
    expect(ancient).toEqual([])
    const meta = await db.select().from(memoryLedger).where(eq(memoryLedger.action, 'meta'))
    expect(meta.length).toBeGreaterThan(0)
  })
})
