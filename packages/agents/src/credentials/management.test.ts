/** Registered callers, write-only registration, and atomic D1 revocation. @module */
import { env, exports } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { auditLog, credentials } from '../../drizzle/management/schema.ts'
import { managementDb } from '../management/db.ts'
import { principalOf } from '../management/principals.ts'
import { uuidv7 } from '../lib/uuid.ts'
import { createAgentModels } from '../models/index.ts'
import { credentialCoverage, putCredential, revokeCredential } from './management.ts'

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
