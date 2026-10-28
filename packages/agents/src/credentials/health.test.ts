/** Refresh health is revision/lease guarded and stores only allowlisted failure categories. @module */
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { auditLog, credentials } from '../../drizzle/management/schema.ts'
import { uuidv7 } from '../lib/uuid.ts'
import { managementDb } from '../management/db.ts'
import { recordRefreshFailure } from './health.ts'

const db = managementDb(env.MANAGEMENT_DB)

async function lease() {
  const leaseId = uuidv7()
  const [row] = await db
    .insert(credentials)
    .values({
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
    .returning()
  if (!row) throw new Error('Missing fixture')
  return { row, leaseId }
}

it.each(['expired', 'revision', 'revoked', 'lease'] as const)(
  'ignores a %s stale refresh writer',
  async (change) => {
    const { row, leaseId } = await lease()
    await db
      .update(credentials)
      .set({
        ...(change === 'expired' ? { leaseExpiresAt: 2 } : {}),
        ...(change === 'revision' ? { revision: 2 } : {}),
        ...(change === 'revoked' ? { status: 'revoked' as const } : {}),
        ...(change === 'lease' ? { leaseId: uuidv7() } : {}),
      })
      .where(eq(credentials.credentialId, row.credentialId))
    expect(
      await recordRefreshFailure(db, row, leaseId, 3, new Error('secret remote payload')),
    ).toBeUndefined()
    expect(await db.select().from(auditLog).where(eq(auditLog.targetId, row.credentialId))).toEqual(
      [],
    )
    expect(
      await db
        .select()
        .from(credentials)
        .where(eq(credentials.credentialId, row.credentialId))
        .get(),
    ).toMatchObject({ refreshFailures: 0 })
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
  const events = await db.select().from(auditLog).where(eq(auditLog.targetId, row.credentialId))
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({ actorId: null, action: 'credential.refresh.failed' })
  expect(JSON.stringify(events)).not.toContain(message)
})
