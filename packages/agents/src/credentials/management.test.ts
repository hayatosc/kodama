/** Registered callers, write-only registration, and atomic D1 revocation. @module */
import { env, exports } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { auditLog, credentials, credentialGrants } from '../../drizzle/management/schema.ts'
import { managementDb } from '../management/db.ts'
import { principalOf } from '../management/principals.ts'
import { newAgentId } from '../helper/management.ts'
import { uuidv7 } from '../lib/uuid.ts'
import { createAgentModels } from '../models/index.ts'
import {
  credentialCoverage,
  credentialRow,
  grantCredential,
  putCredential,
  revokeCredential,
} from './management.ts'
import { credentialFingerprint } from './encryption.ts'

const db = managementDb(env.MANAGEMENT_DB)

async function caller() {
  const actor = { kind: 'user' as const, externalId: `${uuidv7()}@example.test` }
  const principal = await principalOf(db, actor, Date.now())
  return {
    actor,
    call: {
      db,
      env,
      models: createAgentModels(),
      now: Date.now(),
      principal,
    },
  }
}

it('returns only metadata through RPC and records a secret-free registration audit', async () => {
  const { actor } = await caller()
  const request = { requestId: uuidv7(), provider: 'openai', secret: 'sk-credential-test-123456' }
  const result = await exports.default.putCredential(actor, request)
  expect(result.last4).toBe('3456')
  expect(result.fingerprint).toBe(
    await credentialFingerprint(request.secret, env.CREDENTIAL_KEK_V1),
  )
  expect(result).not.toHaveProperty('ciphertext')
  expect(result).not.toHaveProperty('wrappedDek')
  expect(await exports.default.putCredential(actor, request)).toEqual(result)
  expect(JSON.stringify(await exports.default.listCredentials(actor))).not.toContain(request.secret)
  const rows = await db
    .select()
    .from(credentials)
    .where(eq(credentials.credentialId, result.credentialId))
  expect(JSON.stringify(rows)).not.toContain(request.secret)
  const audits = await db.select().from(auditLog).where(eq(auditLog.targetId, result.credentialId))
  expect(audits).toHaveLength(1)
  expect(audits[0]?.detailJson).toContain(result.fingerprint)
  expect(JSON.stringify(audits)).not.toContain(request.secret)
})

it('rejects credential-shaped request IDs before persisting audit or credential rows', async () => {
  const { call } = await caller()
  const before = await db.select().from(credentials)
  const audits = await db.select().from(auditLog)
  const requestId = `sk-${'x'.repeat(32)}`
  await expect(putCredential(call, env, { requestId, provider: 'openai', secret: 'safe-test-key' })).rejects.toThrow('requestId must not contain credential text')
  expect(await db.select().from(credentials)).toEqual(before)
  expect(await db.select().from(auditLog)).toEqual(audits)
})

it('replays identical concurrent registrations without extra credentials or audits', async () => {
  const { call } = await caller()
  const input = { requestId: uuidv7(), provider: 'openai', secret: 'concurrent-secret-key' }
  const before = await db.select().from(credentials)
  const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'credential.put'))
  const [first, second] = await Promise.all([
    putCredential(call, env, input),
    putCredential(call, env, input),
  ])
  expect(second).toEqual(first)
  expect(await db.select().from(credentials)).toHaveLength(before.length + 1)
  expect(
    await db.select().from(auditLog).where(eq(auditLog.action, 'credential.put')),
  ).toHaveLength(audits.length + 1)
})

it('reports a credential conflict for concurrent reuse with different content', async () => {
  const { call } = await caller()
  const input = { requestId: uuidv7(), provider: 'openai', secret: 'concurrent-secret-key' }
  const before = await db.select().from(credentials)
  const results = await Promise.allSettled([
    putCredential(call, env, input),
    putCredential(call, env, { ...input, secret: 'different-secret-key' }),
  ])
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  const failed = results.find((result) => result.status === 'rejected')
  if (failed?.status !== 'rejected') throw new Error('Expected rejected retry')
  expect(String(failed.reason)).toContain('credential_conflict')
  expect(await db.select().from(credentials)).toHaveLength(before.length + 1)
})

it('names credential IDs in validation errors', async () => {
  const { call } = await caller()
  await expect(credentialRow(call, 'invalid')).rejects.toThrow(
    'credentialId must be a lowercase UUID v7',
  )
  await expect(credentialRow(call, uuidv7())).rejects.toThrow('Unknown credential')
})

it('replays concurrent duplicate grants with a single audit', async () => {
  const { call } = await caller()
  const credential = await putCredential(call, env, {
    requestId: uuidv7(),
    provider: 'openai',
    secret: 'concurrent-grant-secret',
  })
  const agentId = await newAgentId()
  const results = await Promise.all([
    grantCredential(call, credential.credentialId, agentId),
    grantCredential(call, credential.credentialId, agentId),
  ])
  expect(results[0]).toEqual(results[1])
  expect(
    await db
      .select()
      .from(credentialGrants)
      .where(eq(credentialGrants.credentialId, credential.credentialId)),
  ).toHaveLength(1)
  const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'credential.grant'))
  expect(audits.filter((row) => row.detailJson.includes(credential.credentialId))).toHaveLength(1)
})

it('rejects a grant to an unknown agent without writing a grant or audit', async () => {
  const { call } = await caller()
  const credential = await putCredential(call, env, {
    requestId: uuidv7(),
    provider: 'openai',
    secret: 'sk-grant-test-1234',
  })
  await expect(grantCredential(call, credential.credentialId, uuidv7())).rejects.toThrow(
    new TypeError('Unknown agent'),
  )
  expect(
    await db
      .select()
      .from(credentialGrants)
      .where(eq(credentialGrants.credentialId, credential.credentialId)),
  ).toEqual([])
  expect(
    await db.select().from(auditLog).where(eq(auditLog.targetId, credential.credentialId)),
  ).toHaveLength(1)
})

it('allows non-owner callers and does not echo invalid secret inputs', async () => {
  const { actor, call } = await caller()
  expect(await exports.default.listCredentials(actor)).toBeInstanceOf(Array)
  await expect(putCredential(call, env, { secret: 'sk-sensitive-input' })).rejects.toThrow(
    'Invalid credential registration',
  )
})

it('uses the same caller rules for principal-owned subscriptions and API keys', async () => {
  const first = await caller()
  const second = await caller()
  const registered = await putCredential(first.call, env, {
    requestId: uuidv7(),
    kind: 'oauth_subscription',
    provider: 'openai',
    ownerScope: 'principal',
    secret: JSON.stringify({
      type: 'oauth',
      access: 'access-token',
      refresh: 'refresh-token',
      expires: Date.now() + 60_000,
    }),
  })
  expect(JSON.stringify(registered)).not.toContain('access-token')
  expect((await credentialCoverage(second.call, registered.credentialId)).credential).toMatchObject(
    {
      credentialId: registered.credentialId,
      kind: 'oauth_subscription',
    },
  )
})

it('preserves the first revocation and one audit for concurrent retries', async () => {
  const { call } = await caller()
  const credential = await putCredential(call, env, {
    requestId: uuidv7(),
    provider: 'openai',
    secret: 'sk-concurrent-test-1234',
  })
  const results = await Promise.all([
    revokeCredential(call, credential.credentialId),
    revokeCredential({ ...call, now: call.now + 1000 }, credential.credentialId),
  ])
  expect(results[0]).toEqual(results[1])
  const row = await db
    .select()
    .from(credentials)
    .where(eq(credentials.credentialId, credential.credentialId))
    .get()
  expect([call.now, call.now + 1000]).toContain(row?.revokedAt)
  await revokeCredential({ ...call, now: call.now + 2000 }, credential.credentialId)
  expect(
    await db
      .select()
      .from(credentials)
      .where(eq(credentials.credentialId, credential.credentialId))
      .get(),
  ).toEqual(row)
  expect(
    await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.opId, `credential.revoke:${credential.credentialId}`)),
  ).toHaveLength(1)
})

it.each(['api_key', 'oauth_subscription'] as const)(
  'revokes %s, clears its envelope and lease, and preserves state on retry',
  async (kind) => {
    const { call } = await caller()
    const credential = await putCredential(call, env, {
      requestId: uuidv7(),
      provider: 'openai',
      kind,
      secret:
        kind === 'api_key'
          ? 'sk-revocation-key-1234'
          : JSON.stringify({
              type: 'oauth',
              access: 'access-test',
              refresh: 'refresh-test',
              expires: Date.now() + 60000,
            }),
    })
    await db
      .update(credentials)
      .set({ leaseId: 'in-flight-refresh', leaseExpiresAt: call.now + 30000 })
      .where(eq(credentials.credentialId, credential.credentialId))
    expect(await revokeCredential(call, credential.credentialId)).toEqual({
      credentialId: credential.credentialId,
      status: 'revoked',
      affectedAgents: [],
    })
    const row = await db
      .select()
      .from(credentials)
      .where(eq(credentials.credentialId, credential.credentialId))
      .get()
    expect(row).toMatchObject({
      status: 'revoked',
      ciphertext: null,
      iv: null,
      wrappedDek: null,
      wrapIv: null,
      leaseId: null,
      leaseExpiresAt: null,
      revokedAt: call.now,
    })
    await revokeCredential({ ...call, now: call.now + 1000 }, credential.credentialId)
    expect(
      await db
        .select()
        .from(credentials)
        .where(eq(credentials.credentialId, credential.credentialId))
        .get(),
    ).toEqual(row)
    expect(
      await db.select().from(auditLog).where(eq(auditLog.targetId, credential.credentialId)),
    ).toHaveLength(2)
  },
)
