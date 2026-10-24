/**
 * Extraction may only checkpoint and cite entries its job actually read.
 *
 * @module
 */
import { exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { newAgentId } from '../../helper/control.ts'
import { db, memoryAgent, activeContents } from '../../helper/memory.ts'
import { waitForAnswer } from '../../helper/rpc.ts'
import {
  isMemoryAgentRequest,
  requestBody,
  textResponse,
  toolCallResponse,
  toolResults,
} from '../../helper/model.ts'
import { extractionCheckpoint } from '../store/db.ts'
import '@earendil-works/pi-ai/api/openai-responses'

afterEach(() => vi.restoreAllMocks())

describe('extraction read bounds', () => {
  it.each(['checkpoint', 'citation', 'skip', 'valid'] as const)(
    'checks %s against the read page',
    async (mode) => {
      const agentId = await newAgentId()
      const responses: string[] = []
      let through = 0
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
        const body = requestBody(init)
        if (!isMemoryAgentRequest(body)) return textResponse('Noted.')
        const step = toolResults(body)
        if (step === 0)
          return toolCallResponse({
            name: 'read_entries',
            arguments: mode === 'skip' ? { after: 999999 } : {},
          })
        responses.push(body)
        through = Number(/through #(\d+)/.exec(body)?.[1] ?? 0)
        if (step === 1 && mode !== 'skip')
          return toolCallResponse(
            mode === 'citation'
              ? {
                  name: 'memory_write',
                  arguments: {
                    kind: 'fact',
                    content: 'Invented evidence',
                    sourceEntryFrom: through + 100,
                  },
                }
              : {
                  name: 'finish_extraction',
                  arguments: { lastEntryId: through + (mode === 'valid' ? 0 : 100) },
                },
          )
        return textResponse('Finished.')
      })
      await exports.default.sendMessage(agentId, {
        requestId: 'source',
        content: 'Actual evidence',
      })
      await waitForAnswer(agentId, 'source')
      const queued = await memoryAgent().enqueue({
        kind: 'extract',
        sourceAgentId: agentId,
        afterEntry: 0,
      })
      await expect
        .poll(async () => (await memoryAgent().jobStatus(queued.jobId))?.status, {
          timeout: 10_000,
        })
        .toBe('settled')
      if (mode === 'valid') {
        expect(through).toBeGreaterThan(0)
        expect(await extractionCheckpoint(db, agentId)).toBe(through)
      } else {
        expect(await extractionCheckpoint(db, agentId)).toBe(0)
        expect(await activeContents(agentId)).toEqual([])
        expect(responses.join('\n')).toContain('read range')
      }
    },
  )
})
