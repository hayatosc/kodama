/** Assignment and unassignment keep grants, versions, and reverse indexes together. @module */
import { runInDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { expect, it, vi } from 'vite-plus/test'
import { Agent } from '../agent/agent.ts'
import { managementDb } from '../control-plane/db.ts'
import selectAgentById from '../control-plane/sql/select-agent-by-id.sql'
import { uuidv7 } from '../lib/uuid.ts'
import { credentialCall } from '../testing/credentials.ts'
import { newAgentId } from '../testing/management.ts'
import selectAllAgentCredentialRefs from '../testing/sql/select-all-agent-credential-refs.sql'
import selectAllAgents from '../testing/sql/select-all-agents.sql'
import { assignCredential } from './assignments.ts'
import { putCredential } from './management.ts'
import selectCredentialGrant from './sql/select-credential-grant.sql'

it('pushes the committed version even when credential invalidation rejects', async () => {
  const agentId = await newAgentId()
  const call = credentialCall()
  const credential = await putCredential(call, env, {
    requestId: uuidv7(),
    provider: 'openai',
    secret: 'sk-independent-push',
  })
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const invalidation = vi
    .fn<Agent['invalidateCredentials']>()
    .mockRejectedValue(new Error('invalidation unavailable'))
  try {
    await runInDurableObject(env.AGENTS.getByName(agentId), () => {
      vi.spyOn(Agent.prototype, 'invalidateCredentials').mockImplementation(invalidation)
    })
    await assignCredential(call, credential.credentialId, agentId)
    const row = await selectAgentById.run(call.db, { agentId })
    expect(row?.appliedVersion).toBe(row?.currentVersion)
    expect(error).toHaveBeenCalled()
    expect(invalidation).toHaveBeenCalledOnce()
  } finally {
    await runInDurableObject(env.AGENTS.getByName(agentId), () => {
      vi.restoreAllMocks()
    })
    error.mockRestore()
  }
})

it('assigns all agents and unassigns one without revoking the shared key', async () => {
  const db = managementDb(env.MANAGEMENT_DB)
  await exports.default.seed()
  const registered = (await selectAllAgents.run(db))[0]
  if (!registered) throw new Error('Missing registered agent')
  const credential = await exports.default.putCredential({
    requestId: uuidv7(),
    provider: 'openai',
    secret: 'sk-assignment-test-1234',
  })
  const all = await exports.default.assignCredential(credential.credentialId, 'all')
  expect(all.agents.length).toBeGreaterThanOrEqual(2)
  const first = all.agents[0]
  if (!first) throw new Error('Missing seeded agent')
  expect(
    (await selectAllAgentCredentialRefs.run(db)).filter(
      (ref) => ref.credentialId === credential.credentialId,
    ),
  ).toHaveLength(all.agents.length)
  const before = await selectAgentById.run(db, { agentId: first.agentId })
  expect(before?.appliedVersion).toBe(before?.currentVersion)
  const assigned = await exports.default.credentialCoverage(credential.credentialId)
  expect(assigned.references.find((ref) => ref.agentId === first.agentId)).toEqual({
    agentId: first.agentId,
    credentialId: credential.credentialId,
    provider: 'openai',
    version: before?.currentVersion,
  })
  await exports.default.unassignCredential(credential.credentialId, first.agentId)
  const after = await selectAgentById.run(db, { agentId: first.agentId })
  expect(after?.currentVersion).toBe((before?.currentVersion ?? 0) + 1)
  expect(after?.appliedVersion).toBe(after?.currentVersion)
  expect(
    await selectCredentialGrant.run(db, {
      credentialId: credential.credentialId,
      agentId: first.agentId,
    }),
  ).toBeNull()
  const coverage = await exports.default.credentialCoverage(credential.credentialId)
  expect(coverage.credential.status).toBe('active')
  expect(coverage.agents).toHaveLength(all.agents.length - 1)
  expect(coverage.references.some((ref) => ref.agentId === first.agentId)).toBe(false)
})
