/** Assignment and unassignment keep grants, versions, and reverse indexes together. @module */
import { runInDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { and, eq } from 'drizzle-orm'
import { expect, it, vi } from 'vitest'
import { agents, credentialGrants, agentCredentialRefs } from '../../drizzle/management/schema.ts'
import { managementDb } from '../management/db.ts'
import { principalOf } from '../management/principals.ts'
import { uuidv7 } from '../lib/uuid.ts'
import { credentialCall } from '../helper/credentials.ts'
import { newAgentId } from '../helper/management.ts'
import { assignCredential } from './assignments.ts'
import { putCredential } from './management.ts'

it('pushes the committed version even when credential invalidation rejects', async () => {
  const agentId = await newAgentId()
  const call = await credentialCall()
  const credential = await putCredential(call, env, {
    requestId: uuidv7(),
    provider: 'openai',
    secret: 'sk-independent-push',
  })
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    await runInDurableObject(env.AGENTS.getByName(agentId), (instance) => {
      vi.spyOn(instance, 'invalidateCredentials').mockRejectedValue(
        new Error('invalidation unavailable'),
      )
    })
    await assignCredential(call, credential.credentialId, agentId)
    const row = await call.db.select().from(agents).where(eq(agents.agentId, agentId)).get()
    expect(row?.appliedVersion).toBe(row?.currentVersion)
    expect(error).toHaveBeenCalled()
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
  const registered = await db.select().from(agents).get()
  if (!registered) throw new Error('Missing registered agent')
  const actor = { kind: 'agent' as const, externalId: registered.agentId }
  const principal = await principalOf(db, actor, Date.now())
  expect(principal.systemRole).not.toBe('owner')
  const credential = await exports.default.putCredential(actor, {
    requestId: uuidv7(),
    provider: 'openai',
    secret: 'sk-assignment-test-1234',
  })
  const all = await exports.default.assignCredential(actor, credential.credentialId, 'all')
  expect(all.agents.length).toBeGreaterThanOrEqual(2)
  const first = all.agents[0]
  if (!first) throw new Error('Missing seeded agent')
  expect(
    await db
      .select()
      .from(agentCredentialRefs)
      .where(eq(agentCredentialRefs.credentialId, credential.credentialId)),
  ).toHaveLength(all.agents.length)
  const before = await db.select().from(agents).where(eq(agents.agentId, first.agentId)).get()
  expect(before?.appliedVersion).toBe(before?.currentVersion)
  const assigned = await exports.default.credentialCoverage(actor, credential.credentialId)
  expect(assigned.references.find((ref) => ref.agentId === first.agentId)).toEqual({
    agentId: first.agentId,
    credentialId: credential.credentialId,
    provider: 'openai',
    version: before?.currentVersion,
  })
  await exports.default.unassignCredential(actor, credential.credentialId, first.agentId)
  const after = await db.select().from(agents).where(eq(agents.agentId, first.agentId)).get()
  expect(after?.currentVersion).toBe((before?.currentVersion ?? 0) + 1)
  expect(after?.appliedVersion).toBe(after?.currentVersion)
  expect(
    await db
      .select()
      .from(credentialGrants)
      .where(
        and(
          eq(credentialGrants.credentialId, credential.credentialId),
          eq(credentialGrants.agentId, first.agentId),
        ),
      ),
  ).toHaveLength(0)
  const coverage = await exports.default.credentialCoverage(actor, credential.credentialId)
  expect(coverage.credential.status).toBe('active')
  expect(coverage.agents).toHaveLength(all.agents.length - 1)
  expect(coverage.references.some((ref) => ref.agentId === first.agentId)).toBe(false)
})
