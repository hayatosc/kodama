/**
 * Working memory tools expose effective records, not superseded shared policies, and limit how
 * much one turn may ask to remember.
 *
 * @module
 */
import { ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import { contactBoundary } from '../../agent/local-db/external-data.ts'
import { runInDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { memoryJobs } from '../../../drizzle/durable-object/schema.ts'
import { MEMORY_AGENT_NAME, parseMemoryJob } from '../../memory/jobs.ts'
import { openLocalDb } from '../../agent/local-db/local.ts'
import { waitForAnswer, modelResponse } from '../../testing/rpc.ts'
import { uuidv7 } from '../../lib/uuid.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { newAgentId, updateSettings } from '../../testing/management.ts'
import { mockModel, say } from '../../testing/conversation.ts'
import { record, write } from '../../testing/memory.ts'
import { toolCallResponse } from '../../testing/model.ts'
import type { ToolCall } from '../../testing/model.ts'
import { REMEMBER_LIMIT_PER_TURN } from '../../memory/working/remember.ts'
// Load the provider outside short-lived DO requests.
import '@earendil-works/pi-ai/api/openai-responses'

afterEach(() => vi.restoreAllMocks())

it('accepts a peer-influenced remember request with an earlier human input', async () => {
  const peer = await newAgentId()
  const receiver = await newAgentId()
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => modelResponse())
  await exports.default.sendMessage(receiver, {
    requestId: 'earlier-human',
    content: 'A normal human request.',
  })
  await waitForAnswer(receiver, 'earlier-human')
  const content = `Peer fact ${receiver}`
  fetch
    .mockImplementationOnce(async () =>
      toolCallResponse({ name: 'remember', arguments: { content } }),
    )
    .mockImplementationOnce(async () => modelResponse('Kept.'))
  await env.AGENTS.getByName(peer).sendTo(receiver, {
    requestId: 'peer-memory',
    content: 'Remember this fact.',
  })
  await waitForAnswer(receiver, 'peer-memory')

  using snapshot = await exports.default.snapshot(receiver)
  const peerInput = snapshot.snapshot.messages.find((message) =>
    message.text.includes('Remember this fact.'),
  )
  const jobs = await runInDurableObject(
    env.AGENTS.getByName(MEMORY_AGENT_NAME),
    async (_instance, state) => (await openLocalDb(state.storage)).select().from(memoryJobs).all(),
  )
  const job = jobs
    .map((row) => parseMemoryJob(JSON.parse(row.payloadJson)))
    .find((parsed) => parsed.kind === 'remember' && parsed.content === content)
  expect(peerInput).toBeDefined()
  expect(job).toMatchObject({ kind: 'remember' })
  expect(JSON.stringify(fetch.mock.calls.at(-1))).toContain('accepted')
})

describe('working memory search', () => {
  it('returns learned observations without changing agent permissions', async () => {
    const agentId = await newAgentId()
    await write({
      scope: `agent:${agentId}`,
      sourceAgentId: agentId,
      kind: 'event',
      content: 'External staging observation',
    })
    const boundary = () =>
      runInDurableObject(env.AGENTS.getByName(agentId), async (_agent, state) =>
        contactBoundary(await openLocalDb(state.storage), String(ROOT_CONVERSATION_ID)),
      )
    expect(await boundary()).toBeUndefined()
    const bodies = scriptedTurn([{ name: 'memory_search', arguments: { query: 'staging' } }])
    await say(agentId, 'external-search', 'Look up staging')
    expect(bodies.at(-1)).toContain('[event] External staging observation')
    expect(await boundary()).toBeUndefined()
  })

  it('hides prohibited overrides even when the required policy does not match the query', async () => {
    const agentId = await newAgentId()
    const space = `space-${uuidv7().slice(-12)}`
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
      arguments: { content: `Preference ${i}` },
    }))
    const bodies = scriptedTurn(calls)

    await say(agentId, 'remember-many', 'Remember all of these')

    const last = bodies.at(-1) ?? ''
    expect(last.split('accepted (job ')).toHaveLength(REMEMBER_LIMIT_PER_TURN + 1)
    expect(last).toContain(`Not saved: at most ${REMEMBER_LIMIT_PER_TURN} memories per turn`)
  })

  it('blocks remember when the memory policy disables it, and tools the tool policy denies', async () => {
    const agentId = await newAgentId()
    await updateSettings(agentId, {
      memoryPolicy: { extract: true, remember: false },
      toolPolicy: { memory_search: 'deny' },
    })
    const bodies = scriptedTurn([
      { name: 'remember', arguments: { content: 'Prefer tabs' } },
      { name: 'memory_search', arguments: { query: 'tabs' } },
    ])

    await say(agentId, 'policy-blocked', 'Remember that I prefer tabs')

    const last = bodies.at(-1) ?? ''
    expect(last).toContain("remember is disabled by the agent's memory policy")
    expect(last).toContain("tool memory_search is denied by the agent's tool policy")
    expect(last).not.toContain('accepted (job ')
  })
})
