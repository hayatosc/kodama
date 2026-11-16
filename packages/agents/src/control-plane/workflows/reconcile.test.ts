/**
 * Reconciliation advances past failing agents and wraps its persisted cursor without starvation.
 *
 * @module
 */
import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { STATUS_KEY } from '../../agent/runtime/restrictions.ts'
import { prepareQuery, runBatch } from '../../lib/reylo.ts'
import { uuidv7 } from '../../lib/uuid.ts'
import { management, newAgentId } from '../../testing/management.ts'
import { modelResponse } from '../../testing/rpc.ts'
import selectAuditByTarget from '../../testing/sql/select-audit-by-target.sql'
import setAgentStatus from '../../testing/sql/set-agent-status.sql'
import setAgentVersions from '../../testing/sql/set-agent-versions.sql'
import { defaultAgentSettings } from '../config.ts'
import { managementDb } from '../db.ts'
import { createAgentModels } from '../models.ts'
import insertAgent from '../sql/insert-agent.sql'
import insertConfigVersion from '../sql/insert-config-version.sql'
import selectAgentById from '../sql/select-agent-by-id.sql'
import selectSetting from '../sql/select-setting.sql'
import { reconcileAgents } from './reconcile.ts'
// Load the provider outside short-lived DO requests.
import '@earendil-works/pi-ai/api/openai-responses'

afterEach(() => vi.restoreAllMocks())

function reconcile() {
  return reconcileAgents({
    env,
    db: managementDb(env.MANAGEMENT_DB),
    models: createAgentModels(),
    source: 'system',
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
      kind: 'working',
      displayName: 'stuck',
      slug: null,
      status: 'active',
      currentVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    }
  })
  // One batch avoids a round trip per fixture; separate inserts respect D1's parameter limit.
  await runBatch(
    management,
    rows.map((row) => prepareQuery(management, insertAgent, row)),
  )
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
    await runBatch(management, [
      prepareQuery(management, insertConfigVersion, {
        agentId,
        version: 1,
        settingsJson: JSON.stringify(settings),
        schemaVersion: 1,
        source: 'system',
        comment: null,
        createdAt: Date.now(),
      }),
      prepareQuery(management, setAgentVersions, {
        agentId,
        currentVersion: 1,
        appliedVersion: 0,
      }),
    ])

    expect(await reconcile()).toEqual({ pushed: 100, behind: 100 })
    const cursor = () => selectSetting.run(management, { key: 'reconcile_cursor' })
    expect((await cursor())?.valueJson).toBe(JSON.stringify(stuckIds.at(-1)))
    expect(await selectAgentById.run(management, { agentId })).toMatchObject({ appliedVersion: 0 })

    // The next run reaches the healthy agent, then wraps to the first 99 failures.
    expect(await reconcile()).toEqual({ pushed: 100, behind: 99 })
    expect((await cursor())?.valueJson).toBe(JSON.stringify(stuckIds.at(-2)))
    const attemptedIds = [...stuckIds, ...stuckIds.slice(0, 99)]
    expect(errors.mock.calls).toEqual(
      attemptedIds.map((id) => [`Reconciling agent ${id} failed`, 'TypeError']),
    )

    const row = await selectAgentById.run(management, { agentId })
    expect(row).toMatchObject({ currentVersion: 1, appliedVersion: 1 })
    expect((await env.AGENTS.getByName(agentId).getConfig()).systemPrompt).toBe('Reached at last')
  })

  it('finishes an agent stuck in provisioning: its object and registry become active', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const agentId = await newAgentId()
    await env.AGENTS.getByName(agentId).setStatus('provisioning')
    await setAgentStatus.run(management, { agentId, status: 'provisioning' })
    const status = async () => (await selectAgentById.run(management, { agentId }))?.status

    // Earlier tests may leave failing agents ahead of the cursor; a few runs reach every agent.
    for (let run = 0; run < 3 && (await status()) === 'provisioning'; run++) await reconcile()

    expect(await status()).toBe('active')
    expect(
      await runInDurableObject(env.AGENTS.getByName(agentId), (_instance, state) =>
        state.storage.kv.get(STATUS_KEY),
      ),
    ).toBe('active')
    const audits = await selectAuditByTarget.run(management, { targetId: agentId })
    expect(audits.filter((row) => row.action === 'agent.activate')).toHaveLength(1)
  })
})
