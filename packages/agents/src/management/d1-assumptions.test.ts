import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { agentConfigVersions, agentMembers, agents } from '../../drizzle/management/schema.ts'
import { errorText } from '../lib/errors.ts'
import { managementDb } from './db.ts'

const db = managementDb(env.MANAGEMENT_DB)

function registryRow(agentId: string) {
  return {
    agentId,
    objectName: agentId,
    kind: 'working' as const,
    displayName: 'test',
    status: 'active' as const,
    currentVersion: 1,
    createdAt: 0,
    updatedAt: 0,
  }
}

function versionRow(agentId: string, version: number) {
  return { agentId, version, settingsJson: '{}', schemaVersion: 1, createdAt: 0 }
}

// The management database keeps references consistent with foreign keys and one batch() per change;
// these are the D1 behaviors that relies on. Run them again on D1 emulator or Drizzle upgrades.
describe('D1 behavior the management database relies on', () => {
  it('enforces foreign keys by default', async () => {
    const error = await db
      .insert(agentConfigVersions)
      .values(versionRow(crypto.randomUUID(), 1))
      .catch((caught: unknown) => caught)
    expect(errorText(error)).toMatch(/FOREIGN KEY constraint failed/)
  })

  it('rolls back the whole batch when a later statement breaks a foreign key', async () => {
    const agentId = crypto.randomUUID()
    await expect(
      db.batch([
        db.insert(agents).values(registryRow(agentId)),
        db
          .insert(agentMembers)
          .values({ agentId, principalId: crypto.randomUUID(), role: 'owner' }),
      ]),
    ).rejects.toThrow()
    expect(await db.select().from(agents).where(eq(agents.agentId, agentId)).get()).toBeUndefined()
  })

  it('rolls back the whole batch when a later statement breaks a primary key', async () => {
    const agentId = crypto.randomUUID()
    await db.batch([
      db.insert(agents).values(registryRow(agentId)),
      db.insert(agentConfigVersions).values(versionRow(agentId, 1)),
    ])
    await expect(
      db.batch([
        db.update(agents).set({ currentVersion: 2 }).where(eq(agents.agentId, agentId)),
        db.insert(agentConfigVersions).values(versionRow(agentId, 1)),
      ]),
    ).rejects.toSatisfy((error) => /UNIQUE constraint failed/.test(errorText(error)))
    const row = await db.select().from(agents).where(eq(agents.agentId, agentId)).get()
    expect(row?.currentVersion).toBe(1)
  })

  it('returns no row from an UPDATE … RETURNING that matches nothing', async () => {
    const row = await db
      .update(agents)
      .set({ status: 'paused' })
      .where(eq(agents.agentId, crypto.randomUUID()))
      .returning()
      .get()
    expect(row).toBeUndefined()
  })

  it('enforces the object_name check for working agents', async () => {
    const agentId = crypto.randomUUID()
    const error = await db
      .insert(agents)
      .values({ ...registryRow(agentId), objectName: 'typo' })
      .catch((caught: unknown) => caught)
    expect(errorText(error)).toMatch(/CHECK constraint failed: agents_object_name/)
  })
})
