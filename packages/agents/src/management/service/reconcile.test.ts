/**
 * Reconciliation advances past failing agents and wraps its persisted cursor without starvation.
 *
 * @module
 */
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentConfigVersions, agents, systemSettings } from '../../../drizzle/management/schema.ts'
import { defaultAgentSettings } from '../../configuration/index.ts'
import { management, newAgentId } from '../../helper/management.ts'
import { modelResponse } from '../../helper/rpc.ts'
import { uuidv7 } from '../../lib/uuid.ts'
import { managementDb } from '../db.ts'
import { createAgentModels } from '../../models/index.ts'
import { reconcileAgents } from './reconcile.ts'
// Load the provider outside short-lived DO requests.
import '@earendil-works/pi-ai/api/openai-responses'

afterEach(() => vi.restoreAllMocks())

function reconcile() {
  return reconcileAgents({
    env,
    db: managementDb(env.MANAGEMENT_DB),
    models: createAgentModels(env),
    principal: null,
    now: Date.now(),
  })
}

/** Agents behind their desired version whose push fails every time: the version row is missing. */
async function stuckAgents(count: number): Promise<string[]> {
  const rows = Array.from({ length: count }, () => {
    const agentId = uuidv7(1)
    return {
      agentId,
      objectName: agentId,
      kind: 'working' as const,
      displayName: 'stuck',
      status: 'active' as const,
      currentVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    }
  })
  // One batch avoids a round trip per fixture; separate inserts respect D1's parameter limit.
  const [first, ...rest] = rows.map((row) => management.insert(agents).values(row))
  if (first !== undefined) await management.batch([first, ...rest])
  return rows.map((row) => row.agentId).sort()
}

describe('reconcileAgents', () => {
  it('continues past a full failed batch and wraps without starving later agents', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => modelResponse())
    // Assert expected failures without forwarding hundreds of stack traces to the test runner.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const stuckIds = await stuckAgents(100)
    // A version written while its push was lost: the object has never heard of it.
    const agentId = await newAgentId(undefined, false)
    const settings = { ...defaultAgentSettings(env), systemPrompt: 'Reached at last' }
    await management.batch([
      management.insert(agentConfigVersions).values({
        agentId,
        version: 1,
        settingsJson: JSON.stringify(settings),
        schemaVersion: 1,
        createdAt: Date.now(),
      }),
      management.update(agents).set({ currentVersion: 1 }).where(eq(agents.agentId, agentId)),
    ])

    expect(await reconcile()).toEqual({ pushed: 100, behind: 100 })
    const cursor = () =>
      management
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.key, 'reconcile_cursor'))
        .get()
    expect((await cursor())?.valueJson).toBe(JSON.stringify(stuckIds.at(-1)))
    expect(
      await management.select().from(agents).where(eq(agents.agentId, agentId)).get(),
    ).toMatchObject({ appliedVersion: 0 })

    // The next run reaches the healthy agent, then wraps to the first 99 failures.
    expect(await reconcile()).toEqual({ pushed: 100, behind: 99 })
    expect((await cursor())?.valueJson).toBe(JSON.stringify(stuckIds.at(-2)))
    const attemptedIds = [...stuckIds, ...stuckIds.slice(0, 99)]
    expect(errors.mock.calls).toEqual(
      attemptedIds.map((id) => [
        `Reconciling agent ${id} failed`,
        new TypeError(`Unknown version 1 of agent ${id}`),
      ]),
    )

    const row = await management.select().from(agents).where(eq(agents.agentId, agentId)).get()
    expect(row).toMatchObject({ currentVersion: 1, appliedVersion: 1 })
    expect((await env.AGENTS.getByName(agentId).getConfig()).systemPrompt).toBe('Reached at last')
  })
})
