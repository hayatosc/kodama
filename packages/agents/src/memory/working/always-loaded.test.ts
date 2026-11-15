/**
 * Concurrent writes must remain detectable by the always-loaded cache's revision checks.
 *
 * @module
 */
import { uuidv7 } from '../../lib/uuid.ts'
import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test'
import { afterNextMemoryRecordsRead, context, db, write } from '../../testing/memory.ts'
import { openLocalDb } from '../../agent/local-db/local.ts'
import { applyOperation } from '../store/records.ts'
import { memoryRecords } from '../../../drizzle/memory/schema.ts'
import type { Scope } from '../../../drizzle/memory/schema.ts'
import { SEARCH_VERSION } from '../../lib/search-text.ts'
import {
  AGENT_FACT_BUDGET,
  AGENT_INSTRUCTION_BUDGET,
  refreshAlwaysLoaded,
  renderAlwaysLoaded,
  refreshAlwaysLoadedIfChanged,
  REVISION_CHECK_INTERVAL_MS,
  SHARED_MEMORY_BUDGET,
  storedMemoryText,
} from './always-loaded.ts'
import { seedOnce } from '../../testing/management.ts'

// The memory agent needs the seeded installation and its credentials.
beforeAll(seedOnce)

afterEach(() => vi.restoreAllMocks())

describe('always-loaded cache revisions', () => {
  it('detects a shared replacement committed between reading content and storing its revision', async () => {
    const agentId = uuidv7()
    const space = uuidv7()
    const oldId = await write({
      scope: `shared:${space}`,
      kind: 'instruction',
      content: 'Deploy to the old region',
      sourceAgentId: agentId,
      required: true,
    })
    const stub = env.AGENTS.getByName(agentId)
    let clock = Date.now()
    const texts = await runInDurableObject(stub, async (_instance, state) => {
      const local = await openLocalDb(state.storage)
      const memory = {
        env,
        agentId: () => agentId,
        local: () => Promise.resolve(local),
        sharedSpaces: () => Promise.resolve([space]),
        now: () => clock,
      }
      // Return the shared rows already read (after the agent's own), but commit a real D1
      // replacement before rendering resumes.
      afterNextMemoryRecordsRead(
        env.MEMORY_DB,
        async () => {
          const result = await applyOperation(db, context(clock), {
            type: 'supersede',
            oldId,
            oldRevision: 1,
            record: {
              scope: `shared:${space}`,
              kind: 'instruction',
              content: 'Deploy to the new region',
              origin: 'consolidation',
              sourceAgentId: agentId,
              observedAt: clock,
              required: true,
            },
          })
          expect(result.status).toBe('applied')
        },
        2,
      )
      await refreshAlwaysLoaded(memory)
      const initial = await storedMemoryText(memory)
      clock += REVISION_CHECK_INTERVAL_MS - 1
      await refreshAlwaysLoadedIfChanged(memory)
      const early = await storedMemoryText(memory)
      clock += 1
      await refreshAlwaysLoadedIfChanged(memory)
      return { initial, early, late: await storedMemoryText(memory) }
    })

    expect(texts.initial).toContain('Deploy to the old region')
    expect(texts.initial).not.toContain('Deploy to the new region')
    expect(texts.early).toBe(texts.initial)
    expect(texts.late).toContain('Deploy to the new region')
    expect(texts.late).not.toContain('Deploy to the old region')
  })
})

describe('always-loaded budgets', () => {
  /** The lines of one static-header block and their serialized character cost. */
  function block(text: string, label: string) {
    const lines = text.split('\n')
    const start = lines.findIndex((line) => line === label)
    expect(start).toBeGreaterThan(-1)
    const end = lines.findIndex((line, index) => index > start && !line.startsWith('- '))
    const body = lines.slice(start + 1, end === -1 ? undefined : end)
    const used = body.reduce((sum, line) => sum + line.length + 1, 0)
    return { body, used }
  }

  it('keeps instructions and facts in separate static-header budgets alongside shared records', async () => {
    const agentId = uuidv7()
    const space = uuidv7()
    const padded = (label: string) => label.padEnd(100, '.')
    await write({
      scope: `agent:${agentId}`,
      kind: 'instruction',
      content: padded('Standing instruction 0'),
      sourceAgentId: agentId,
      importance: 0.1,
    })
    for (let index = 0; index < 20; index++) {
      await write({
        scope: `agent:${agentId}`,
        kind: 'fact',
        content: padded(`Agent fact ${index}`),
        sourceAgentId: agentId,
        importance: 0.9 + index / 1000,
      })
      if (index < 15) {
        await write({
          scope: `shared:${space}`,
          kind: 'fact',
          content: padded(`Shared fact ${index}`),
          sourceAgentId: agentId,
          importance: index / 100,
        })
      }
    }

    const { text } = await renderAlwaysLoaded(db, agentId, [space])

    expect([AGENT_INSTRUCTION_BUDGET, AGENT_FACT_BUDGET, SHARED_MEMORY_BUDGET]).toEqual([
      1_200, 1_500, 1_000,
    ])
    const instructions = block(text, 'INSTRUCTIONS')
    const notes = block(text, 'NOTES')
    const shared = block(text, 'SHARED')
    // Standing instruction is preserved despite 20 higher-importance facts.
    expect(instructions.body).toEqual([`- ${padded('Standing instruction 0')}`])
    // Each line is 103 characters with its newline: 14 fit in 1,500, and 9 in 1,000.
    expect(notes.used).toBe(14 * 103)
    expect(shared.used).toBe(9 * 103)
    expect(notes.body[0]).toBe(`- ${padded('Agent fact 19')}`)
    expect(text).not.toContain('Agent fact 5.')
    expect(shared.body[0]).toBe(`- ${padded('Shared fact 14')}`)
    expect(text).not.toContain('Shared fact 5.')
  })

  it('applies overrides before limiting the rows a block reads', async () => {
    const agentId = uuidv7()
    const space = uuidv7()
    const now = Date.now()
    const row = (id: string, scope: Scope, importance: number, overrides?: string) => ({
      id,
      scope,
      kind: 'fact' as const,
      content: 'x',
      searchVersion: SEARCH_VERSION,
      origin: 'remember' as const,
      sourceAgentId: agentId,
      runId: 'override-limit',
      importance,
      ...(overrides === undefined ? {} : { overrides }),
      observedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    // 255 one-character shared lines, of which the ten most important are overridden.
    const sharedRows = Array.from({ length: 255 }, (_, index) =>
      row(`${space}-${index}`, `shared:${space}`, 1 - index / 1000),
    )
    const overrides = sharedRows
      .slice(0, 10)
      .map((target, index) => row(`${agentId}-${index}`, `agent:${agentId}`, 0.5, target.id))
    const rows = [...sharedRows, ...overrides]
    const inserts = []
    for (let offset = 0; offset < rows.length; offset += 5) {
      inserts.push(db.insert(memoryRecords).values(rows.slice(offset, offset + 5)))
    }
    const [first, ...rest] = inserts
    if (first !== undefined) await db.batch([first, ...rest])

    const { text } = await renderAlwaysLoaded(db, agentId, [space])

    // The block holds 250 such lines, so overridden rows must not use up its reads.
    expect(block(text, 'SHARED').body).toHaveLength(245)
  })
})
