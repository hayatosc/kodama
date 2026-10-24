import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentConfigVersions, agents } from '../../../drizzle/management/schema.ts'
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
async function stuckAgents(count: number): Promise<void> {
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
  // D1 binds at most 100 parameters per statement.
  for (const row of rows) await management.insert(agents).values(row)
}

describe('reconcileAgents', () => {
  it('reaches every agent behind its version, even behind more failing ones than one run takes', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => modelResponse())
    await stuckAgents(100)
    // A version written while its push was lost: the object has never heard of it.
    const agentId = await newAgentId()
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

    for (let run = 0; run < 3; run++) await reconcile()

    const row = await management.select().from(agents).where(eq(agents.agentId, agentId)).get()
    expect(row).toMatchObject({ currentVersion: 1, appliedVersion: 1 })
    expect((await env.AGENTS.getByName(agentId).getConfig()).systemPrompt).toBe('Reached at last')
  })
})
