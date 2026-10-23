/**
 * Working memory tools expose effective records, not superseded shared policies.
 *
 * @module
 */
import { exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockModel, say } from '../../helper/conversation.ts'
import { record, write } from '../../helper/memory.ts'
import { toolCallResponse } from '../../helper/model.ts'
// Load the provider outside short-lived DO requests.
import '@earendil-works/pi-ai/api/openai-responses'

afterEach(() => vi.restoreAllMocks())

describe('working memory search', () => {
  it('hides prohibited overrides even when the required policy does not match the query', async () => {
    const agentId = crypto.randomUUID()
    const space = `space-${crypto.randomUUID().slice(0, 8)}`
    using config = await exports.default.getConfig(agentId)
    await exports.default.setConfig(agentId, { ...config, sharedSpaces: [space] })
    const target = await write({
      scope: `shared:${space}`,
      kind: 'instruction',
      content: 'Never push to main',
      sourceAgentId: 'memory',
      required: true,
    })
    const prohibited = await write({
      scope: `agent:${agentId}`,
      kind: 'instruction',
      content: 'Pushing to main is fine',
      sourceAgentId: agentId,
      overrides: target,
    })
    let pending = true
    const bodies = mockModel({
      usage: () => 5,
      answer: () => {
        if (!pending) return undefined
        pending = false
        return toolCallResponse({ name: 'memory_search', arguments: { query: 'Pushing' } })
      },
    })
    await say(agentId, 'search-precedence', 'Look up earlier guidance')
    expect(bodies.at(-1)).toContain('No matching memory.')
    expect(bodies.at(-1)).not.toContain('Pushing to main is fine')
    expect((await record(prohibited))?.useCount).toBe(0)
  })
})
