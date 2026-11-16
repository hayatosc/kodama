/** Registered callers, write-only registration, and atomic D1 revocation. @module */
import { env, exports } from 'cloudflare:workers'
import { expect, it } from 'vite-plus/test'
import { managementDb } from '../control-plane/db.ts'
import { createAgentModels } from '../control-plane/models.ts'
import selectAuditByOpId from '../control-plane/sql/select-audit-by-op-id.sql'
import { uuidv7 } from '../lib/uuid.ts'
import { newAgentId } from '../testing/management.ts'
import selectAllAuditLog from '../testing/sql/select-all-audit-log.sql'
import selectAllCredentials from '../testing/sql/select-all-credentials.sql'
import selectAuditByAction from '../testing/sql/select-audit-by-action.sql'
import selectAuditByTarget from '../testing/sql/select-audit-by-target.sql'
import setCredentialHealthFields from '../testing/sql/set-credential-health-fields.sql'
import setCredentialLease from '../testing/sql/set-credential-lease.sql'
import { credentialFingerprint } from './encryption.ts'
import {
  credentialCoverage,
  credentialRow,
  grantCredential,
  putCredential,
  revokeCredential,
} from './management.ts'
import selectCredentialById from './sql/select-credential-by-id.sql'
import selectCredentialGrantsByCredential from './sql/select-credential-grants-by-credential.sql'

const db = managementDb(env.MANAGEMENT_DB)

function caller() {
  return {
    call: {
      db,
      env,
      models: createAgentModels(),
      now: Date.now(),
      source: 'operator' as const,
    },
  }
}

it('returns only metadata through RPC and records a secret-free registration audit', async () => {
  const request = { requestId: uuidv7(), provider: 'openai', secret: 'sk-credential-test-123456' }
  const result = await exports.default.putCredential(request)
  expect(result.last4).toBe('3456')
  expect(result.fingerprint).toBe(
    await credentialFingerprint(request.secret, env.CREDENTIAL_KEK_V1),
  )
  expect(result).not.toHaveProperty('ciphertext')
  expect(result).not.toHaveProperty('wrappedDek')
  expect(await exports.default.putCredential(request)).toEqual(result)
  expect(JSON.stringify(await exports.default.listCredentials())).not.toContain(request.secret)
  const row = await selectCredentialById.run(db, { credentialId: result.credentialId })
  expect(JSON.stringify(row)).not.toContain(request.secret)
  const audits = await selectAuditByTarget.run(db, { targetId: result.credentialId })
  expect(audits).toHaveLength(1)
  expect(audits[0]?.detailJson).toContain(result.fingerprint)
  expect(JSON.stringify(audits)).not.toContain(request.secret)
})

it('lists credential health from metadata without decrypting the envelope', async () => {
  const value = await exports.default.putCredential({
    requestId: uuidv7(),
    provider: 'openai',
    kind: 'oauth_subscription',
    secret: JSON.stringify({
      type: 'oauth',
      access: 'access12',
      refresh: 'refresh1',
      expires: 9000,
    }),
  })
  expect(value).toMatchObject({
    expiresAt: 9000,
    lastUsedAt: null,
    lastRefreshedAt: null,
    refreshFailures: 0,
  })
  await setCredentialHealthFields.run(db, {
    credentialId: value.credentialId,
    ciphertext: 'unreadable-envelope',
    wrappedDek: 'unreadable-envelope',
    lastUsedAt: 1000,
    lastRefreshedAt: 2000,
    refreshFailures: 2,
    lastRefreshFailureAt: 3000,
    lastRefreshFailureCategory: 'transient',
  })
  const metadata = (await exports.default.listCredentials()).find(
    (entry) => entry.credentialId === value.credentialId,
  )
  expect(metadata).toMatchObject({
    status: 'active',
    expiresAt: 9000,
    lastUsedAt: 1000,
    lastRefreshedAt: 2000,
    refreshFailures: 2,
    lastRefreshFailureAt: 3000,
    lastRefreshFailureCategory: 'transient',
  })
  expect(JSON.stringify(metadata)).not.toMatch(
    /unreadable-envelope|access12|refresh1|ciphertext|wrappedDek/,
  )
})

it('replays credential-shaped request IDs without changing their identity', async () => {
  const { call } = caller()
  const before = await selectAllCredentials.run(db)
  const audits = await selectAllAuditLog.run(db)
  const requestId = `sk-${'x'.repeat(32)}`
  const input = { requestId, provider: 'openai', secret: 'safe-test-key' }
  const first = await putCredential(call, env, input)
  expect(await putCredential(call, env, input)).toEqual(first)
  expect(await selectAllCredentials.run(db)).toHaveLength(before.length + 1)
  expect(await selectAllAuditLog.run(db)).toHaveLength(audits.length + 1)
})

it('replays identical concurrent registrations without extra credentials or audits', async () => {
  const { call } = caller()
  const input = { requestId: uuidv7(), provider: 'openai', secret: 'concurrent-secret-key' }
  const before = await selectAllCredentials.run(db)
  const audits = await selectAuditByAction.run(db, { action: 'credential.put' })
  const [first, second] = await Promise.all([
    putCredential(call, env, input),
    putCredential(call, env, input),
  ])
  expect(second).toEqual(first)
  expect(await selectAllCredentials.run(db)).toHaveLength(before.length + 1)
  expect(await selectAuditByAction.run(db, { action: 'credential.put' })).toHaveLength(
    audits.length + 1,
  )
})

it('reports a credential conflict for concurrent reuse with different content', async () => {
  const { call } = caller()
  const input = { requestId: uuidv7(), provider: 'openai', secret: 'concurrent-secret-key' }
  const before = await selectAllCredentials.run(db)
  const results = await Promise.allSettled([
    putCredential(call, env, input),
    putCredential(call, env, { ...input, secret: 'different-secret-key' }),
  ])
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  const failed = results.find((result) => result.status === 'rejected')
  if (failed?.status !== 'rejected') throw new Error('Expected rejected retry')
  expect(String(failed.reason)).toContain('credential_conflict')
  expect(await selectAllCredentials.run(db)).toHaveLength(before.length + 1)
})

it('names credential IDs in validation errors', async () => {
  const { call } = caller()
  await expect(credentialRow(call, 'invalid')).rejects.toThrow(
    'credentialId must be a lowercase UUID v7',
  )
  await expect(credentialRow(call, uuidv7())).rejects.toThrow('Unknown credential')
})

it('replays concurrent duplicate grants with a single audit', async () => {
  const { call } = caller()
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
    await selectCredentialGrantsByCredential.run(db, { credentialId: credential.credentialId }),
  ).toHaveLength(1)
  const audits = await selectAuditByAction.run(db, { action: 'credential.grant' })
  expect(audits.filter((row) => row.detailJson.includes(credential.credentialId))).toHaveLength(1)
})

it('rejects a grant to an unknown agent without writing a grant or audit', async () => {
  const { call } = caller()
  const credential = await putCredential(call, env, {
    requestId: uuidv7(),
    provider: 'openai',
    secret: 'sk-grant-test-1234',
  })
  await expect(grantCredential(call, credential.credentialId, uuidv7())).rejects.toThrow(
    new TypeError('Unknown agent'),
  )
  expect(
    await selectCredentialGrantsByCredential.run(db, { credentialId: credential.credentialId }),
  ).toEqual([])
  expect(await selectAuditByTarget.run(db, { targetId: credential.credentialId })).toHaveLength(1)
})

it('uses the private operator boundary and does not echo invalid secret inputs', async () => {
  const { call } = caller()
  expect(await exports.default.listCredentials()).toBeInstanceOf(Array)
  await expect(putCredential(call, env, { secret: 'sk-sensitive-input' })).rejects.toThrow(
    'Invalid credential registration',
  )
})

it('shares subscription credentials across trusted installation calls without user scopes', async () => {
  const first = caller()
  const second = caller()
  const registered = await putCredential(first.call, env, {
    requestId: uuidv7(),
    kind: 'oauth_subscription',
    provider: 'openai',
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
  const { call } = caller()
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
  const row = await selectCredentialById.run(db, { credentialId: credential.credentialId })
  expect([call.now, call.now + 1000]).toContain(row?.revokedAt)
  await revokeCredential({ ...call, now: call.now + 2000 }, credential.credentialId)
  expect(await selectCredentialById.run(db, { credentialId: credential.credentialId })).toEqual(row)
  expect(
    await selectAuditByOpId.run(db, { opId: `credential.revoke:${credential.credentialId}` }),
  ).not.toBeNull()
})

it.each(['api_key', 'oauth_subscription'] as const)(
  'revokes %s, clears its envelope and lease, and preserves state on retry',
  async (kind) => {
    const { call } = caller()
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
    await setCredentialLease.run(db, {
      credentialId: credential.credentialId,
      leaseId: 'in-flight-refresh',
      leaseExpiresAt: call.now + 30000,
    })
    expect(await revokeCredential(call, credential.credentialId)).toEqual({
      credentialId: credential.credentialId,
      status: 'revoked',
      affectedAgents: [],
    })
    const row = await selectCredentialById.run(db, { credentialId: credential.credentialId })
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
    expect(await selectCredentialById.run(db, { credentialId: credential.credentialId })).toEqual(
      row,
    )
    expect(await selectAuditByTarget.run(db, { targetId: credential.credentialId })).toHaveLength(2)
  },
)
