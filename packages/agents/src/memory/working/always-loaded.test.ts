/**
 * Concurrent writes must remain detectable by the always-loaded cache's revision checks.
 *
 * @module
 */
import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { afterNextMemoryRecordsRead, context, db, write } from '../../helper/memory.ts'
import { openLocalDb } from '../../storage/local.ts'
import { applyOperation } from '../store/records.ts'
import {
  refreshAlwaysLoaded,
  refreshAlwaysLoadedIfChanged,
  REVISION_CHECK_INTERVAL_MS,
  storedMemoryText,
} from './always-loaded.ts'

afterEach(() => vi.restoreAllMocks())

describe('always-loaded cache revisions', () => {
  it('detects a shared replacement committed between reading content and storing its revision', async () => {
    const agentId = crypto.randomUUID()
    const space = crypto.randomUUID()
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
      // Return the rows already read, but commit a real D1 replacement before rendering resumes.
      afterNextMemoryRecordsRead(env.MEMORY_DB, async () => {
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
      })
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
