/** Audit reads preserve replay history, actor identity and safe, exclusive pagination. @module */
import { env } from 'cloudflare:workers'
import { expect, it } from 'vite-plus/test'
import { auditLog } from '../../drizzle/management/schema.ts'
import { agentService, caller } from '../testing/management.ts'
import { uuidv7 } from '../lib/uuid.ts'
import { AuditQuerySchema, parseInput } from '../validation.ts'
import { managementDb } from './db.ts'
import { auditByOpId, auditStatement, readAudit } from './audit.ts'

const db = managementDb(env.MANAGEMENT_DB)

it('reads real credential operations with their actor and without secrets or read-generated events', async () => {
  await caller()
  const secret = 'sk-audit-fixture-secret'
  const metadata = await agentService().putCredential({
    requestId: uuidv7(),
    provider: 'openai',
    secret,
  })
  await agentService().revokeCredential(metadata.credentialId)
  const before = await db.select().from(auditLog)
  const result = await agentService().audit({ targetId: metadata.credentialId, limit: 50 })
  expect(result.entries.map((row) => row.action)).toEqual(['credential.revoke', 'credential.put'])
  expect(
    result.entries.every(
      (row) => row.source === before.find((entry) => entry.seq === row.seq)?.source,
    ),
  ).toBe(true)
  expect(result.entries[0]?.source).toBe('operator')
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
      source: 'system',
      action: 'system.seed',
      targetKind: 'system',
      targetId,
    }),
    auditStatement(db, {
      opId: uuidv7(),
      at: Date.now(),
      source: 'system',
      action: 'credential.refresh.failed',
      targetKind: 'system',
      targetId,
      detail: { category: 'transient' },
    }),
  ])
  const first = await readAudit(db, { targetId, limit: 1 })
  expect(first.entries).toHaveLength(1)
  expect(first.entries[0]).toMatchObject({ source: 'system', detail: { category: 'transient' } })
  if (first.nextCursor === null) throw new Error('Missing continuation')
  const last = await agentService().audit({
    targetId,
    before: first.nextCursor,
    limit: 1,
  })
  expect(last.entries).toHaveLength(1)
  expect(last.entries[0]).toMatchObject({ opId, at: 1, source: 'system' })
  expect(last.nextCursor).toBeNull()
  expect(await auditByOpId(db, opId)).toMatchObject({ opId, at: 1 })
})

it('bounds audit reads without provisioning caller identities', async () => {
  for (const query of [
    { limit: 201 },
    { limit: 0 },
    { before: -1 },
    { before: 1.5 },
    { targetId: '' },
  ])
    expect(() => parseInput(AuditQuerySchema, query)).toThrow(TypeError)
  expect((await agentService().audit({})).entries).toBeInstanceOf(Array)
})
