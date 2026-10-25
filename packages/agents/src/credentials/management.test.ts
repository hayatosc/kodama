/** Owner authorization, write-only registration, and durable revocation receipts. @module */
import { env, exports } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { auditLog, credentials, principals } from '../../drizzle/management/schema.ts'
import { managementDb } from '../management/db.ts'
import { principalOf } from '../management/principals.ts'
import { uuidv7 } from '../lib/uuid.ts'
import { createAgentModels } from '../models/index.ts'
import { putCredential, revokeCredential } from './management.ts'

const db = managementDb(env.MANAGEMENT_DB)

async function owner() {
  const actor = { kind: 'user' as const, externalId: `${uuidv7()}@example.test` }
  const principal = await principalOf(db, actor, Date.now())
  await db
    .update(principals)
    .set({ systemRole: 'owner' })
    .where(eq(principals.principalId, principal.principalId))
  return {
    actor,
    call: {
      db,
      env,
      models: createAgentModels(env),
      now: Date.now(),
      principal: { ...principal, systemRole: 'owner' as const },
    },
  }
}

it('returns only metadata through RPC and records a secret-free registration audit', async () => {
  const { actor } = await owner()
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

it('refuses non-owners and does not echo invalid secret inputs', async () => {
  const actor = { kind: 'user' as const, externalId: `${uuidv7()}@example.test` }
  await expect(Promise.resolve(exports.default.listCredentials(actor))).rejects.toThrow(
    'forbidden:',
  )
  const { call } = await owner()
  await expect(putCredential(call, env, { secret: 'sk-sensitive-input' })).rejects.toThrow(
    'Invalid credential registration',
  )
})

it('fails closed on R2 failure and completes the same revocation on retry', async () => {
  const { call } = await owner()
  const credential = await putCredential(call, env, {
    requestId: uuidv7(),
    provider: 'openai',
    secret: 'sk-revocation-key-1234',
  })
  const failedEnv = {
    CREDENTIAL_BACKUPS: {
      ...env.CREDENTIAL_BACKUPS,
      put: async () => {
        throw new Error('unavailable')
      },
    },
  }
  await expect(revokeCredential(call, failedEnv, credential.credentialId)).rejects.toThrow(
    'credential_revocation_incomplete',
  )
  const row = await db
    .select()
    .from(credentials)
    .where(eq(credentials.credentialId, credential.credentialId))
    .get()
  expect(row?.status).toBe('revoked')
  expect(row?.ciphertext).toBeNull()
  expect(row?.revocationRecordedAt).toBeNull()
  await revokeCredential(call, env, credential.credentialId)
  expect(
    await (await env.CREDENTIAL_BACKUPS.get(`revocations/${credential.credentialId}.json`))?.json(),
  ).toEqual({ credentialId: credential.credentialId, revokedAt: call.now })
  expect(
    await db.select().from(auditLog).where(eq(auditLog.targetId, credential.credentialId)),
  ).toHaveLength(2)
})
