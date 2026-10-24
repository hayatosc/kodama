/**
 * Working memory tools expose effective records, not superseded shared policies, and limit how
 * much one turn may ask to remember.
 *
 * @module
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { newAgentId, updateSettings } from '../../helper/management.ts'
import { mockModel, say } from '../../helper/conversation.ts'
import { record, write } from '../../helper/memory.ts'
import { toolCallResponse } from '../../helper/model.ts'
import type { ToolCall } from '../../helper/model.ts'
import { REMEMBER_LIMIT_PER_TURN } from '../../memory/working/remember.ts'
// Load the provider outside short-lived DO requests.
import '@earendil-works/pi-ai/api/openai-responses'

afterEach(() => vi.restoreAllMocks())

describe('working memory search', () => {
  it('hides prohibited overrides even when the required policy does not match the query', async () => {
    const agentId = await newAgentId()
    const space = `space-${crypto.randomUUID().slice(0, 8)}`
    await updateSettings(agentId, { sharedSpaces: [space] })
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

/** Answer the next turn with `calls`, one per model request, then plain text. */
function scriptedTurn(calls: readonly ToolCall[]) {
  return mockModel({
    usage: () => 5,
    answer: (_body, n) => {
      const call = calls[n]
      return call === undefined ? undefined : toolCallResponse(call)
    },
  })
}

describe('working memory tools', () => {
  it('reports found records, empty history, and unknown skills to the model', async () => {
    const agentId = await newAgentId()
    await write({
      scope: `agent:${agentId}`,
      kind: 'fact',
      content: 'The staging cluster is in Osaka',
      sourceAgentId: agentId,
    })
    const bodies = scriptedTurn([
      { name: 'memory_search', arguments: { query: 'staging cluster' } },
      { name: 'history_search', arguments: { query: 'codename' } },
      { name: 'skill_read', arguments: { name: 'deploy' } },
      { name: 'skill_read', arguments: { name: 'Not A Name' } },
    ])

    await say(agentId, 'lookups', 'Where is staging?')

    const last = bodies.at(-1) ?? ''
    expect(last).toContain('- [fact] The staging cluster is in Osaka')
    expect(last).toContain('No matching archived history.')
    expect(last).toContain('No skill named deploy')
    expect(last).toContain('No skill named Not A Name')
  })

  it(`accepts at most ${REMEMBER_LIMIT_PER_TURN} remember requests in one turn`, async () => {
    const agentId = await newAgentId()
    const calls = Array.from({ length: REMEMBER_LIMIT_PER_TURN + 1 }, (_, i) => ({
      name: 'remember',
      arguments: { content: `Preference ${i}`, origin: 'user_request' },
    }))
    const bodies = scriptedTurn(calls)

    await say(agentId, 'remember-many', 'Remember all of these')

    const last = bodies.at(-1) ?? ''
    expect(last.split('accepted (job ')).toHaveLength(REMEMBER_LIMIT_PER_TURN + 1)
    expect(last).toContain(`Not saved: at most ${REMEMBER_LIMIT_PER_TURN} memories per turn`)
  })
})
