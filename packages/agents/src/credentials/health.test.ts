/** Refresh health is revision/lease guarded and stores only allowlisted failure categories. @module */
import { env } from 'cloudflare:workers'
import { expect, it } from 'vite-plus/test'
import { managementDb } from '../control-plane/db.ts'
import { uuidv7 } from '../lib/uuid.ts'
import insertLeasedCredential from '../testing/sql/insert-leased-credential.sql'
import selectAuditByTarget from '../testing/sql/select-audit-by-target.sql'
import updateLeasedCredentialFields from '../testing/sql/update-leased-credential-fields.sql'
import { recordRefreshFailure } from './health.ts'
import selectCredentialById from './sql/select-credential-by-id.sql'
import { parseCredentialRow } from './vault.ts'

const db = managementDb(env.MANAGEMENT_DB)

async function lease() {
  const leaseId = uuidv7()
  const raw = await insertLeasedCredential.run(db, {
    credentialId: uuidv7(),
    kind: 'oauth_subscription',
    provider: 'openai',
    status: 'active',
    ciphertext: '',
    wrappedDek: '',
    revision: 1,
    fingerprint: 'fixture',
    last4: '',
    createdAt: 1,
    leaseId,
    leaseExpiresAt: 10_000,
  })
  if (!raw) throw new Error('Missing fixture')
  return { row: parseCredentialRow(raw), leaseId }
}

it.each(['expired', 'revision', 'revoked', 'lease'] as const)(
  'ignores a %s stale refresh writer',
  async (change) => {
    const { row, leaseId } = await lease()
    await updateLeasedCredentialFields.run(db, {
      credentialId: row.credentialId,
      leaseExpiresAt: change === 'expired' ? 2 : row.leaseExpiresAt,
      revision: change === 'revision' ? 2 : row.revision,
      status: change === 'revoked' ? 'revoked' : row.status,
      leaseId: change === 'lease' ? uuidv7() : row.leaseId,
    })
    expect(
      await recordRefreshFailure(db, row, leaseId, 3, new Error('secret remote payload')),
    ).toBeUndefined()
    expect(await selectAuditByTarget.run(db, { targetId: row.credentialId })).toEqual([])
    expect(await selectCredentialById.run(db, { credentialId: row.credentialId })).toMatchObject({
      refreshFailures: 0,
    })
  },
)

it.each([
  ['credential_unavailable: invalid OAuth refresh response', 'malformed'],
  ['credential_unavailable: OAuth refresh request failed', 'transient'],
  ['secret remote payload', 'failed'],
])('records %s as a safe category with no raw remote body', async (message, category) => {
  const { row, leaseId } = await lease()
  expect(await recordRefreshFailure(db, row, leaseId, 3, new Error(message))).toMatchObject({
    status: 'active',
    refreshFailures: 1,
    lastRefreshFailureAt: 3,
    lastRefreshFailureCategory: category,
  })
  const events = await selectAuditByTarget.run(db, { targetId: row.credentialId })
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({ source: 'system', action: 'credential.refresh.failed' })
  expect(JSON.stringify(events)).not.toContain(message)
})
