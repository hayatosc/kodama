import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyOperation } from '../memory/store/records.ts'
import { extractionCheckpoint } from '../memory/store/db.ts'
import {
  refreshAlwaysLoaded,
  refreshAlwaysLoadedIfChanged,
  storedMemoryText,
} from '../memory/working/always-loaded.ts'
import { openLocalDb } from '../storage/local.ts'
import {
  isMemoryAgentRequest,
  requestBody,
  textResponse,
  toolCallResponse,
  toolResults,
} from '../helper/model.ts'
import { activeContents, db } from '../helper/memory.ts'
import { waitForAnswer } from '../helper/rpc.ts'
// Load the provider before RPC calls so Vite's module fetch is outside a short-lived DO request.
import '@earendil-works/pi-ai/api/openai-responses'

afterEach(() => vi.restoreAllMocks())

describe('extraction', () => {
  it('extracts the entries of an idle agent and advances its checkpoint', async () => {
    const agentId = crypto.randomUUID()
    const decision = `We decided to deploy with wrangler ${agentId.slice(0, 8)}`
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = requestBody(init)
      if (!isMemoryAgentRequest(body)) return textResponse('Noted.')
      const step = toolResults(body)
      if (step === 0) return toolCallResponse({ name: 'read_entries', arguments: {} })
      if (step === 1) {
        const entry = /#(\d+) user: We decided/.exec(body)?.[1]
        return toolCallResponse({
          name: 'memory_write',
          arguments: { kind: 'fact', content: decision, sourceEntryFrom: Number(entry) },
        })
      }
      if (step === 2) {
        const through = /through #(\d+)/.exec(body)?.[1]
        return toolCallResponse({
          name: 'finish_extraction',
          arguments: { lastEntryId: Number(through) },
        })
      }
      return textResponse('Extracted.')
    })
    await exports.default.sendMessage(agentId, { requestId: 'decide', content: decision })
    await waitForAnswer(agentId, 'decide')

    const stub = env.AGENTS.getByName(agentId)
    // The extraction alarm is due ten minutes after the agent goes idle; make it due now.
    await runInDurableObject(stub, (_instance, state) =>
      state.storage.put('kodama:alarm:extract', Date.now() - 1),
    )
    await runDurableObjectAlarm(stub)

    await expect.poll(() => activeContents(agentId), { timeout: 10_000 }).toEqual([decision])
    await expect
      .poll(() => extractionCheckpoint(db, agentId), { timeout: 10_000 })
      .toBeGreaterThan(0)
  })
})

describe('always-loaded memory', () => {
  it('picks up a change whose notice was lost once the revision check interval has passed', async () => {
    const agentId = crypto.randomUUID()
    const stub = env.AGENTS.getByName(agentId)
    let clock = Date.UTC(2026, 9, 1)

    const texts = await runInDurableObject(stub, async (_instance, state) => {
      const local = await openLocalDb(state.storage)
      const memory = {
        env,
        agentId: () => agentId,
        local: () => Promise.resolve(local),
        sharedSpaces: () => Promise.resolve(['global']),
        now: () => clock,
      }
      await refreshAlwaysLoaded(memory)
      await applyOperation(
        db,
        { opId: crypto.randomUUID(), jobId: 'job', runId: 'run', actor: 'test', now: clock },
        {
          type: 'write',
          record: {
            scope: `agent:${agentId}`,
            kind: 'instruction',
            content: 'Answer in Japanese',
            origin: 'user_request',
            sourceAgentId: agentId,
            sourceEntries: { from: 1, to: 1 },
            observedAt: clock,
          },
        },
      )
      clock += 1_000
      await refreshAlwaysLoadedIfChanged(memory)
      const early = await storedMemoryText(memory)
      clock += 60_000
      await refreshAlwaysLoadedIfChanged(memory)
      return { early, late: await storedMemoryText(memory) }
    })

    expect(texts.early).not.toContain('Answer in Japanese')
    expect(texts.late).toContain('Answer in Japanese')
  })
})
