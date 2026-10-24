import { listDurableObjectIds } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { agents } from '../../drizzle/control/schema.ts'
import { control, newAgentId, seedOnce } from '../helper/control.ts'
import { useMockModel, waitForAnswer } from '../helper/rpc.ts'
import { uuidv7 } from '../lib/uuid.ts'
import { resolveAgentRef } from './registry.ts'
// Load the provider outside short-lived DO requests.
import '@earendil-works/pi-ai/api/openai-responses'

useMockModel()

/** Whether the object named `name` has any storage. */
async function hasStorage(name: string): Promise<boolean> {
  const id = env.AGENTS.idFromName(name)
  return (await listDurableObjectIds(env.AGENTS)).some((listed) => listed.equals(id))
}

function rejection(promise: Promise<unknown>): Promise<string> {
  return Promise.resolve(promise).then(
    () => 'accepted',
    (error: unknown) => String(error),
  )
}

describe('AgentService admission', () => {
  it('rejects non-UUID, unregistered, and dedicated IDs before any object storage exists', async () => {
    const { memoryAgentId } = await seedOnce()
    const unknown = uuidv7()
    for (const [agentId, message] of [
      ['assistant', /agentId must be a lowercase UUID/],
      ['kodama:memory', /agentId must be a lowercase UUID/],
      [unknown.toUpperCase(), /agentId must be a lowercase UUID/],
      [unknown, /Unknown agent/],
      [memoryAgentId, /Unknown agent/],
    ] as const) {
      const send = exports.default.sendMessage(agentId, { requestId: 'r', content: 'Hello' })
      expect(await rejection(send)).toMatch(message)
      expect(await rejection(exports.default.snapshot(agentId))).toMatch(message)
      // The seed has initialized the memory agent's own object under its reserved name.
      if (agentId !== 'kodama:memory') expect(await hasStorage(agentId)).toBe(false)
    }
    // The memory agent's own object is never reached through its fixed UUID.
    expect(await hasStorage(memoryAgentId)).toBe(false)
  })

  it('admits a registered working agent by its UUID', async () => {
    const agentId = await newAgentId()
    await exports.default.sendMessage(agentId, { requestId: 'hello', content: 'Hello' })
    await waitForAnswer(agentId, 'hello')
    expect(await hasStorage(agentId)).toBe(true)
  })

  it('refuses chat to an agent that is not active, without reaching its object', async () => {
    const agentId = await newAgentId()
    await control.update(agents).set({ status: 'provisioning' }).where(eq(agents.agentId, agentId))
    const send = exports.default.sendMessage(agentId, { requestId: 'r', content: 'Hello' })
    expect(await rejection(send)).toMatch(/agent_unavailable/)
    expect(await hasStorage(agentId)).toBe(false)
  })
})

describe('resolveAgentRef', () => {
  it('resolves a UUID, a slug, and a unique UUID prefix to the registry row', async () => {
    const agentId = await newAgentId()
    const slug = `ref-${crypto.randomUUID().slice(0, 8)}`
    await control.update(agents).set({ slug }).where(eq(agents.agentId, agentId))
    for (const ref of [agentId, slug, agentId.slice(0, 24)]) {
      expect((await resolveAgentRef(control, ref)).agentId).toBe(agentId)
    }
  })

  it('reports an ambiguous prefix with its candidates, and unknown references', async () => {
    const now = Date.now()
    const first = await newAgentId(uuidv7(now))
    const second = await newAgentId(uuidv7(now))
    const shared = first.slice(0, 13)
    expect(second.startsWith(shared)).toBe(true)
    const ambiguous = await rejection(resolveAgentRef(control, shared))
    expect(ambiguous).toMatch(/Ambiguous agent prefix/)
    expect(ambiguous).toContain(first)
    expect(ambiguous).toContain(second)
    expect(await rejection(resolveAgentRef(control, 'no-such-slug'))).toMatch(/Unknown agent/)
    expect(await rejection(resolveAgentRef(control, 'ab'))).toMatch(/Unknown agent/)
  })
})
