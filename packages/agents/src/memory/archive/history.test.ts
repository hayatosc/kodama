import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { searchHistory } from './history.ts'
import { archiveSegments } from '../../../drizzle/d1/schema.ts'
import { COMPACT_AFTER_TURN_7, compactedAgent, mockModel } from '../../testing/conversation.ts'
import { textResponse, toolCallResponse, toolResults } from '../../testing/model.ts'
import { db } from '../../testing/memory.ts'
// Load the provider before RPC calls so Vite's module fetch is outside a short-lived DO request.
import '@earendil-works/pi-ai/api/openai-responses'

afterEach(() => vi.restoreAllMocks())

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
