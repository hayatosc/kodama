/** Audit reads preserve replay history, actor identity and safe, exclusive pagination. @module */
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { auditLog, principals } from '../../drizzle/management/schema.ts'
import { agentService, caller, principalIdOf } from '../helper/management.ts'
import { uuidv7 } from '../lib/uuid.ts'
import { AuditQuerySchema, parseInput } from '../validation.ts'
import { managementDb } from './db.ts'
import { auditByOpId, auditStatement, readAudit } from './audit.ts'

const db = managementDb(env.MANAGEMENT_DB)

it('reads real credential operations with their actor and without secrets or read-generated events', async () => {
  const actor = await caller()
  const secret = 'sk-audit-fixture-secret'
  const metadata = await agentService().putCredential(actor, {
    requestId: uuidv7(),
    provider: 'openai',
    secret,
  })
  await agentService().revokeCredential(actor, metadata.credentialId)
  const before = await db.select().from(auditLog)
  const result = await agentService().audit(actor, { targetId: metadata.credentialId, limit: 50 })
  expect(result.entries.map((row) => row.action)).toEqual(['credential.revoke', 'credential.put'])
  expect(
    result.entries.every(
      (row) => row.actorId === before.find((entry) => entry.seq === row.seq)?.actorId,
    ),
  ).toBe(true)
  expect(result.entries[0]?.actorId).toBe(await principalIdOf(actor))
  expect(JSON.stringify(result)).not.toMatch(/ciphertext|wrappedDek|sk-audit-fixture-secret/)
  expect(await db.select().from(auditLog)).toEqual(before)
})

it('paginates by exclusive sequence, retains old operation replay, and represents system actors as null', async () => {
  const targetId = uuidv7()
  const opId = uuidv7()
  await db.batch([
    auditStatement(db, {
      opId,
      at: 1,
      actorId: null,
      action: 'system.seed',
      targetKind: 'system',
      targetId,
    }),
    auditStatement(db, {
      opId: uuidv7(),
      at: Date.now(),
      actorId: null,
      action: 'credential.refresh.failed',
      targetKind: 'system',
      targetId,
      detail: { category: 'transient' },
    }),
  ])
  const first = await readAudit(db, { targetId, limit: 1 })
  expect(first.entries).toHaveLength(1)
  expect(first.entries[0]).toMatchObject({ actorId: null, detail: { category: 'transient' } })
  if (first.nextCursor === null) throw new Error('Missing continuation')
  const last = await agentService().audit(await caller(), {
    targetId,
    before: first.nextCursor,
    limit: 1,
  })
  expect(last.entries).toHaveLength(1)
  expect(last.entries[0]).toMatchObject({ opId, at: 1, actorId: null })
  expect(last.nextCursor).toBeNull()
  expect(await auditByOpId(db, opId)).toMatchObject({ opId, at: 1 })
})

it('bounds audit reads and rejects disabled callers', async () => {
  for (const query of [
    { limit: 201 },
    { limit: 0 },
    { before: -1 },
    { before: 1.5 },
    { targetId: '' },
  ])
    expect(() => parseInput(AuditQuerySchema, query)).toThrow(TypeError)
  const actor = { kind: 'user', externalId: 'audit-disabled@example.test' } as const
  await agentService().audit(actor, {})
  await db
    .update(principals)
    .set({ disabledAt: Date.now() })
    .where(eq(principals.principalId, await principalIdOf(actor)))
  await expect(Promise.resolve(agentService().audit(actor, {}))).rejects.toThrow()
})
