/** Shared catalog and creator-only authorization against local management D1. @module */
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { agents, auditLog, principals } from '../../drizzle/management/schema.ts'
import { uuidv7 } from '../lib/uuid.ts'
import { management } from '../testing/management.ts'
import {
  listMcpCatalog,
  mcpCatalogTools,
  mcpOwner,
  ownedMcpServer,
  registerMcpCatalog,
  resolveMcpName,
} from './mcp.ts'

async function owner() {
  const principalId = uuidv7()
  const agentId = uuidv7()
  const now = Date.now()
  await management.batch([
    management.insert(principals).values({
      principalId,
      externalId: principalId,
      kind: 'user',
      displayName: 'Owner',
      createdAt: now,
    }),
    management.insert(agents).values({
      agentId,
      objectName: agentId,
      kind: 'working',
      displayName: 'Agent',
      status: 'active',
      currentVersion: 1,
      ownerId: principalId,
      createdAt: now,
      updatedAt: now,
    }),
  ])
  return principalId
}

describe('MCP shared catalog', () => {
  it('reuses an endpoint across owners without enabling it or changing creator authority', async () => {
    const creator = await owner()
    const other = await owner()
    const endpoint = `https://${uuidv7()}.example.com/mcp`
    const first = await registerMcpCatalog(management, creator, 'Shared', endpoint, Date.now())
    const reused = await registerMcpCatalog(management, other, 'Another name', endpoint, Date.now())
    expect(reused).toEqual(first)
    expect(first.enabled).toBe(false)
    expect(first.creatorId).toBe(creator)
    expect(await mcpCatalogTools(management, first.serverId)).toEqual([])
    expect(await ownedMcpServer(management, creator, first.serverId)).toEqual(first)
    await expect(ownedMcpServer(management, other, first.serverId)).rejects.toThrow(
      'mcp_creator_required',
    )
    expect(await listMcpCatalog(management, other)).toContainEqual(first)
    const audit = await management
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, first.serverId))
    expect(audit).toHaveLength(1)
    expect(audit[0]?.actorId).toBe(creator)
  })

  it('resolves only a unique registered name and does not guess unknown endpoints', async () => {
    const principal = await owner()
    const name = uuidv7()
    expect(await resolveMcpName(management, principal, name)).toBeUndefined()
    const first = await registerMcpCatalog(
      management,
      principal,
      name,
      `https://${uuidv7()}.example.com/mcp`,
      Date.now(),
    )
    expect(await resolveMcpName(management, principal, name)).toEqual(first)
    await registerMcpCatalog(
      management,
      principal,
      name,
      `https://${uuidv7()}.example.com/mcp`,
      Date.now(),
    )
    expect(await resolveMcpName(management, principal, name)).toBeUndefined()
  })

  it('rejects missing and disabled principals', async () => {
    await expect(mcpOwner(management, uuidv7())).rejects.toThrow('mcp_owner_required')
    const principal = await owner()
    await management
      .update(principals)
      .set({ disabledAt: Date.now() })
      .where(eq(principals.principalId, principal))
    await expect(listMcpCatalog(management, principal)).rejects.toThrow('mcp_owner_required')
  })

  it('does not equate a registered principal with owner authority', async () => {
    const principalId = uuidv7()
    await management.insert(principals).values({
      principalId,
      externalId: principalId,
      kind: 'user',
      displayName: 'Not an owner',
      createdAt: Date.now(),
    })
    await expect(mcpOwner(management, principalId)).rejects.toThrow('mcp_owner_required')
  })
})
