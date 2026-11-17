/** Installation-wide catalog and atomic mutation fences against local management D1. @module */
import { describe, expect, it } from 'vite-plus/test'
import { runBatch } from '../../lib/reylo.ts'
import { uuidv7 } from '../../lib/uuid.ts'
import { management } from '../../testing/management.ts'
import {
  listAuditByTarget,
  updateMcpServerEnabledStatement,
} from '../../testing/test-db.repository.ts'
import { commitMcpServerStateStatement } from './catalog.repository.ts'
import {
  listMcpCatalog,
  mcpCatalogTools,
  mcpServer,
  registerMcpCatalog,
  resolveMcpName,
} from './catalog.service.ts'

describe('MCP installation catalog', () => {
  it('reuses an endpoint without identity provisioning or implicit enablement', async () => {
    const endpoint = `https://${uuidv7()}.example.com/mcp`
    const first = await registerMcpCatalog(management, 'Shared', endpoint, Date.now())
    const reused = await registerMcpCatalog(management, 'Another name', endpoint, Date.now())
    expect(reused).toEqual(first)
    expect(first.enabled).toBe(false)
    expect(first).not.toHaveProperty('creatorId')
    expect(await mcpCatalogTools(management, first.serverId)).toEqual([])
    expect(await mcpServer(management, first.serverId)).toEqual(first)
    expect(await listMcpCatalog(management)).toContainEqual(first)
    const audit = await listAuditByTarget(management, { targetId: first.serverId })
    expect(audit).toHaveLength(1)
    expect(audit[0]?.source).toBe('operator')
    expect(audit[0]).not.toHaveProperty('actorId')
  })

  it('resolves only a unique registered name and never guesses unknown endpoints', async () => {
    const name = uuidv7()
    expect(await resolveMcpName(management, name)).toBeUndefined()
    const first = await registerMcpCatalog(
      management,
      name,
      `https://${uuidv7()}.example.com/mcp`,
      Date.now(),
    )
    expect(await resolveMcpName(management, name)).toEqual(first)
    await registerMcpCatalog(management, name, `https://${uuidv7()}.example.com/mcp`, Date.now())
    expect(await resolveMcpName(management, name)).toBeUndefined()
  })

  it('rolls back the entire management mutation when the revision fence fails', async () => {
    const server = await registerMcpCatalog(
      management,
      'Fenced',
      `https://${uuidv7()}.example.com/mcp`,
      Date.now(),
    )
    await expect(
      runBatch(management, [
        commitMcpServerStateStatement(management, {
          operationId: uuidv7(),
          serverId: server.serverId,
          revision: -1,
          catalogVersion: server.catalogVersion,
          createdAt: Date.now(),
        }),
        updateMcpServerEnabledStatement(management, {
          serverId: server.serverId,
          enabled: 1,
        }),
      ]),
    ).rejects.toThrow()
    expect((await mcpServer(management, server.serverId)).enabled).toBe(false)
  })
})
