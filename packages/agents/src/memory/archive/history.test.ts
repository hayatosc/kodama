/**
 * Archive search returns summaries and resumes without skipping matching chunks.
 *
 * @module
 */
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { searchHistory } from './history.ts'
import { archiveSegments } from '../../../drizzle/d1/schema.ts'
import { COMPACT_AFTER_TURN_7, compactedAgent, mockModel, say } from '../../helper/conversation.ts'
import type { ToolCall } from '../../helper/model.ts'
import { buildSegment, exportSegment, segmentId, segmentPrefix, writeSummary } from './segment.ts'
import { textResponse, toolCallResponse, toolResults } from '../../helper/model.ts'
import { db } from '../../helper/memory.ts'
// Load the provider before RPC calls so Vite's module fetch is outside a short-lived DO request.
import '@earendil-works/pi-ai/api/openai-responses'

afterEach(() => vi.restoreAllMocks())

async function archiveChunks(agentId: string, first: number, times: number[]) {
  const rows = times.map((at, index) => ({
    id: first + index,
    record: JSON.stringify({
      id: first + index,
      kind: 'pi.user',
      model: [{ role: 'user', content: `needle ${'x'.repeat(2_000)}`, timestamp: at }],
    }),
  }))
  const last = first + times.length - 1
  const files = await buildSegment(agentId, rows, 1_000)
  const prefix = segmentPrefix(agentId, first, last)
  await exportSegment(env.ARCHIVE, prefix, files)
  await writeSummary(env.ARCHIVE, prefix, `needle summary ${first}`)
  await db.insert(archiveSegments).values({
    id: segmentId(agentId, first, last),
    agentId,
    firstEntry: first,
    lastEntry: last,
    entryCount: rows.length,
    r2Prefix: prefix,
    sha256: files.manifest.sha256,
    bytes: files.manifest.bytes,
    firstAt: files.manifest.firstAt,
    lastAt: files.manifest.lastAt,
    hasSummary: true,
    createdAt: 1_000,
  })
}

describe('archive pagination', () => {
  it('continues inside a segment after five hits without repeating its summary', async () => {
    const agentId = crypto.randomUUID()
    await archiveChunks(agentId, 1, [1_000, 2_000, 3_000, 4_000, 5_000, 6_000])
    const first = await searchHistory(db, env.ARCHIVE, agentId, 'needle')
    expect(first.hits.map((hit) => hit.firstEntry)).toEqual([6, 5, 4, 3, 2])
    expect(first.complete).toBe(false)
    expect(first.nextCursor).toEqual(expect.any(String))
    const next = await searchHistory(db, env.ARCHIVE, agentId, 'needle', {
      cursor: first.nextCursor,
    })
    expect(next.hits.map((hit) => hit.firstEntry)).toEqual([1])
    expect(next.summaries).toEqual([])
    expect(next.complete).toBe(true)
    expect(next.nextCursor).toBeUndefined()
  })

  it('applies a time bound inside a segment and carries it through continuation', async () => {
    const agentId = crypto.randomUUID()
    await archiveChunks(agentId, 1, [1_000, 2_000, 3_000, 4_000, 5_000, 6_000])
    const first = await searchHistory(db, env.ARCHIVE, agentId, 'needle', {
      before: 4_000,
      limit: 2,
    })
    expect(first.hits.map((hit) => hit.firstEntry)).toEqual([3, 2])
    expect(first.summaries).toEqual([])
    expect(first.nextCursor).toEqual(expect.any(String))
    const next = await searchHistory(db, env.ARCHIVE, agentId, 'needle', {
      cursor: first.nextCursor,
      limit: 2,
    })
    expect(next.hits.map((hit) => hit.firstEntry)).toEqual([1])
    expect(next.complete).toBe(true)
  })

  it('uses entry IDs to page equal timestamps across segments without skips or duplicates', async () => {
    const agentId = crypto.randomUUID()
    for (const first of [1, 4, 7]) await archiveChunks(agentId, first, [1_000, 1_000, 1_000])
    const hits: number[] = []
    const summaries: string[] = []
    let cursor: string | undefined
    let complete = false
    for (let page = 0; page < 10 && !complete; page++) {
      const found = await searchHistory(db, env.ARCHIVE, agentId, 'needle', { cursor, limit: 2 })
      hits.push(...found.hits.map((hit) => hit.firstEntry))
      summaries.push(...found.summaries.map((summary) => summary.summary))
      cursor = found.nextCursor
      complete = found.complete
    }
    expect(hits).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1])
    expect(summaries).toEqual(['needle summary 7', 'needle summary 4', 'needle summary 1'])
    expect(complete).toBe(true)
  })

  it('resumes at a segment boundary when the read budget stops a search without hits', async () => {
    const agentId = crypto.randomUUID()
    for (const first of [1, 2]) await archiveChunks(agentId, first, [1_000])
    const first = await searchHistory(db, env.ARCHIVE, agentId, 'absent', { budgetBytes: 1 })
    expect(first).toMatchObject({ hits: [], complete: false, nextCursor: expect.any(String) })
    const next = await searchHistory(db, env.ARCHIVE, agentId, 'absent', {
      cursor: first.nextCursor,
      budgetBytes: 1,
    })
    expect(next).toMatchObject({ hits: [], complete: true })
  })

  it('offers and accepts an opaque continuation through the working agent tool', async () => {
    const agentId = crypto.randomUUID()
    await archiveChunks(agentId, 1, [1_000, 2_000, 3_000, 4_000, 5_000, 6_000])
    let pending: ToolCall | undefined = { name: 'history_search', arguments: { query: 'needle' } }
    const bodies = mockModel({
      usage: () => 5,
      answer: () => {
        const call = pending
        pending = undefined
        return call === undefined ? undefined : toolCallResponse(call)
      },
    })
    await say(agentId, 'history-first', 'Search needle')
    expect(bodies.at(-1)).toContain('pass cursor=')
    expect(bodies.at(-1)).not.toContain('Entries #1-#1')
    const first = await searchHistory(db, env.ARCHIVE, agentId, 'needle')
    pending = {
      name: 'history_search',
      arguments: { query: 'needle', cursor: first.nextCursor },
    }
    await say(agentId, 'history-next', 'Continue searching')
    expect(bodies.at(-1)).toContain('Entries #1-#1')
  })
})

describe('archive summaries', () => {
  it('summarizes an archived segment through the memory agent and finds the summary', async () => {
    const agentId = crypto.randomUUID()
    const summary = `Summary: the release train ${agentId.slice(0, 6)} was agreed`
    mockModel({
      usage: COMPACT_AFTER_TURN_7,
      memory: (body) => {
        const step = toolResults(body)
        if (!body.includes('Job: record_archive')) {
          return step === 0
            ? toolCallResponse({ name: 'memory_decline', arguments: { reason: 'test' } })
            : textResponse('Declined.')
        }
        if (step === 0) return toolCallResponse({ name: 'read_archive', arguments: {} })
        if (step === 1 && body.includes('end of segment')) {
          return toolCallResponse({ name: 'write_archive_summary', arguments: { summary } })
        }
        return textResponse('Summarized.')
      },
    })
    await compactedAgent(agentId, 'summarized')

    expect(await env.AGENTS.getByName(agentId).prune({ force: true })).toBe('pruned')

    const hasSummary = async () => {
      const segment = await db
        .select({ hasSummary: archiveSegments.hasSummary })
        .from(archiveSegments)
        .where(eq(archiveSegments.agentId, agentId))
        .get()
      return segment?.hasSummary
    }
    await expect.poll(hasSummary, { timeout: 10_000 }).toBe(true)
    const found = await searchHistory(db, env.ARCHIVE, agentId, 'release train')
    expect(found.summaries.map((hit) => hit.summary)).toEqual([summary])
  })
})
