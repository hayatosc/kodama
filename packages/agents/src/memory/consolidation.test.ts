/**
 * Daily consolidation and bounded ledger retention within D1's parameter limit.
 *
 * @module
 */
import { uuidv7 } from '../lib/uuid.ts'
import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyOperation } from './store/records.ts'
import { memoryLedger } from '../../drizzle/memory/schema.ts'
import { requestBody, textResponse, toolCallResponse, toolResults } from '../helper/model.ts'
import { activeContents, db, memoryAgent, parameterLimitedDb } from '../helper/memory.ts'
import { consolidateDaily } from './consolidation.ts'
// Load the provider before RPC calls so Vite's module fetch is outside a short-lived DO request.
import '@earendil-works/pi-ai/api/openai-responses'

afterEach(() => vi.restoreAllMocks())

describe('consolidation', () => {
  it.each([
    { expired: 101, remaining: 0 },
    { expired: 500, remaining: 0 },
    { expired: 501, remaining: 0 },
    { expired: 1001, remaining: 0 },
    { expired: 10001, remaining: 1 },
  ])(
    'drains up to 20 bounded batches of $expired expired rows and continues maintenance',
    async ({ expired, remaining }) => {
      const runId = uuidv7()
      const now = Date.now()
      const inserts = Array.from({ length: Math.ceil(expired / 10) }, (_, index) =>
        db.insert(memoryLedger).values(
          Array.from({ length: Math.min(10, expired - index * 10) }, () => ({
            at: 0,
            runId,
            actor: 'test',
            action: 'write' as const,
            target: 'record' as const,
            targetId: 'expired',
          })),
        ),
      )
      for (let offset = 0; offset < inserts.length; offset += 50) {
        const [first, ...rest] = inserts.slice(offset, offset + 50)
        if (first !== undefined) await db.batch([first, ...rest])
      }
      await db.insert(memoryLedger).values({
        at: now,
        runId,
        actor: 'test',
        action: 'write',
        target: 'record',
        targetId: 'retained',
      })

      try {
        const result = await consolidateDaily({
          db: parameterLimitedDb,
          now,
          forgetSettledJobs: async () => 0,
          enqueue: async () => {},
        })

        expect(result).toEqual({ scopes: 0 })
        const rows = await db.select().from(memoryLedger).where(eq(memoryLedger.runId, runId))
        expect(rows.filter((row) => row.targetId === 'expired')).toHaveLength(remaining)
        expect(rows.filter((row) => row.targetId === 'retained')).toHaveLength(1)
        const meta = await db
          .select()
          .from(memoryLedger)
          .where(and(eq(memoryLedger.action, 'meta'), eq(memoryLedger.at, now)))
        expect(meta).toHaveLength(1)
        if (remaining > 0) {
          await consolidateDaily({
            db: parameterLimitedDb,
            now: now + 86400000,
            forgetSettledJobs: async () => 0,
            enqueue: async () => {},
          })
          const later = await db.select().from(memoryLedger).where(eq(memoryLedger.runId, runId))
          expect(later.map((row) => row.targetId)).toEqual(['retained'])
        }
      } finally {
        await db.delete(memoryLedger).where(eq(memoryLedger.runId, runId))
      }
    },
  )

  it('drains settled jobs until empty but caps work when a backlog remains', async () => {
    const now = Date.now()
    const forget = vi
      .fn<(before: number) => Promise<number>>()
      .mockResolvedValueOnce(500)
      .mockResolvedValueOnce(500)
      .mockResolvedValueOnce(1)
      .mockResolvedValue(0)
    await consolidateDaily({ db, now, forgetSettledJobs: forget, enqueue: async () => {} })
    expect(forget).toHaveBeenCalledTimes(4)
    expect(forget).toHaveBeenCalledWith(now - 30 * 86400000)
    forget.mockReset().mockResolvedValue(500)
    await consolidateDaily({ db, now, forgetSettledJobs: forget, enqueue: async () => {} })
    expect(forget).toHaveBeenCalledTimes(20)
  })

  it('merges duplicates of a changed scope and drops ledger rows past the rollback window', async () => {
    const agentId = uuidv7()
    const now = Date.now()
    for (const content of ['The CI runs on Linux', 'CI runs on Linux machines']) {
      await applyOperation(
        db,
        { opId: uuidv7(), jobId: 'seed', runId: 'seed', actor: 'test', now },
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
