/**
 * Probes after compaction and pruning (docs/memory.md, Evaluation). The
 * model is scripted, so these check that what an agent needs reaches its context, not how well a
 * model uses it.
 */
import { evictDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { searchHistory } from '../src/memory/archive/history.ts'
import { applyOperation } from '../src/memory/store/records.ts'
import { memoryDb } from '../src/memory/store/db.ts'
import type { NewRecord } from '../src/memory/store/records.ts'
import { COMPACT_AFTER_TURN_7, compactedAgent, mockModel, say } from './helpers/conversation.ts'
import type { ToolCall } from './helpers/model.ts'
import { toolCallResponse } from './helpers/model.ts'
// Load the provider before RPC calls so Vite's module fetch is outside a short-lived DO request.
import '@earendil-works/pi-ai/api/openai-responses'

const db = memoryDb(env.MEMORY_DB)

afterEach(() => vi.restoreAllMocks())

/** The newest rendering of the `memory` section in a request body. */
function latestMemorySection(body: string): string {
  const start = body.lastIndexOf('<memory>')
  return start < 0 ? '' : body.slice(start, body.indexOf('</memory>', start))
}

describe('evaluation', () => {
  it('keeps recall, history, updates, abstention, and request receipts after pruning', async () => {
    const agentId = crypto.randomUUID()
    const codename = `marigold${agentId.slice(0, 6)}`
    let pending: ToolCall | undefined
    const bodies = mockModel({
      usage: COMPACT_AFTER_TURN_7,
      answer: () => {
        const call = pending
        pending = undefined
        return call === undefined ? undefined : toolCallResponse(call)
      },
    })
    await compactedAgent(agentId, codename)
    using first = await exports.default.submission(agentId, 't0')

    // Extraction's result, citing the first turn: a decision the agent must keep.
    const now = Date.now()
    const decision: NewRecord = {
      scope: `agent:${agentId}`,
      kind: 'instruction',
      content: 'Deploy through the staging cluster first',
      origin: 'extraction',
      sourceAgentId: agentId,
      sourceEntries: { from: 1, to: 1 },
      observedAt: now,
    }
    const written = await applyOperation(
      db,
      { opId: crypto.randomUUID(), jobId: 'eval', runId: 'eval', actor: 'test', now },
      { type: 'write', record: decision },
    )
    const stub = env.AGENTS.getByName(agentId)
    expect(await stub.prune({ force: true })).toBe('pruned')
    await evictDurableObject(stub)

    // Recall: the decision is in the always-loaded memory, the early turns in the summary.
    await say(agentId, 'recall', 'How do we deploy?')
    expect(bodies.at(-1)).toContain('Deploy through the staging cluster first')
    expect(bodies.at(-1)).toContain('Summary: the user set a codename')

    // History: a word only in the pruned entries is found in the archive.
    pending = { name: 'history_search', arguments: { query: codename } }
    await say(agentId, 'history', 'What was the codename?')
    expect(bodies.at(-1)).toContain(`The codename is ${codename}.`)

    // Knowledge update: newer evidence replaces the decision, and only the new one is loaded.
    if (written.status !== 'applied') throw new Error('The decision was not written')
    const superseded = await applyOperation(
      db,
      { opId: crypto.randomUUID(), jobId: 'eval', runId: 'eval', actor: 'test', now: now + 1 },
      {
        type: 'supersede',
        oldId: written.recordId,
        oldRevision: 1,
        record: {
          ...decision,
          content: 'Deploy straight to production',
          sourceEntries: { from: 30, to: 30 },
        },
      },
    )
    expect(superseded.status).toBe('applied')
    await stub.memoryChanged()
    await say(agentId, 'update', 'How do we deploy now?')
    // Pi appends a changed section as a message, so the earlier version stays in history.
    expect(latestMemorySection(bodies.at(-1) ?? '')).toContain('Deploy straight to production')
    expect(latestMemorySection(bodies.at(-1) ?? '')).not.toContain(
      'Deploy through the staging cluster first',
    )

    // Abstention: what was never said is found nowhere.
    pending = { name: 'memory_search', arguments: { query: 'quokka sanctuary' } }
    await say(agentId, 'unknown', 'Where is the quokka sanctuary?')
    expect(bodies.at(-1)).toContain('No matching memory.')

    // Temporal: a search bounded before the archive's time finds nothing older.
    const found = await searchHistory(db, env.ARCHIVE, agentId, codename, {
      before: Date.now() + 1,
    })
    const older = await searchHistory(db, env.ARCHIVE, agentId, codename, { before: 1 })
    expect(found.hits).not.toHaveLength(0)
    expect(older).toMatchObject({ hits: [], complete: true })

    // Receipts: a retried request ID from the pruned range answers with its first submission.
    const requests = bodies.length
    const retried = await exports.default.sendMessage(agentId, {
      requestId: 't0',
      content: 'again',
    })
    expect(retried.submissionId).toBe(first?.submission.id)
    expect(bodies).toHaveLength(requests)
  })
})
