/** MCP catalog and assignment workflows against real local D1, with remote transport fixtures. @module */
import { env } from 'cloudflare:workers'
import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mcpAssignments, mcpTools } from '../../../drizzle/management/schema.ts'
import { desiredSettings, management, newAgentId } from '../../testing/management.ts'
import { createAgentModels } from '../models.ts'
import { guardMcpSelection, registerMcpCatalog } from '../mcp.ts'
import { validateCredentialRefs } from '../../credentials/validation.ts'
import { putMcpBearer } from '../../credentials/mcp-vault.ts'
import { disconnectMcp } from '../../credentials/mcp-refresh.ts'
import { MCP_PROTOCOL } from '../../tools/mcp/transport.ts'
import { uuidv7 } from '../../lib/uuid.ts'
import { assignMcp, discoverMcp, disableMcp } from './mcp.ts'
import { manageMcp } from './mcp-management.ts'

async function fixture() {
  const agentId = await newAgentId()
  const call = {
    env,
    db: management,
    models: createAgentModels(),
    source: 'operator' as const,
    now: Date.now(),
  }
  const server = await registerMcpCatalog(
    management,
    'fixture',
    `https://${uuidv7()}.example.com/mcp`,
    call.now,
  )
  const credential = await putMcpBearer(
    management,
    env.CREDENTIAL_KEK_V1,
    server.serverId,
    'fixture-bearer',
  )
  let definitions = [
    { name: 'read', description: 'Read selected records', inputSchema: { type: 'object' } },
  ]
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
    if (options?.method === 'DELETE') return new Response(null, { status: 204 })
    const body: unknown = JSON.parse(typeof options?.body === 'string' ? options.body : '{}')
    if (!body || typeof body !== 'object' || !('method' in body))
      throw new Error('Bad fixture request')
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 })
    if (!('id' in body)) throw new Error('Missing fixture ID')
    return Response.json({
      jsonrpc: '2.0',
      id: body.id,
      result:
        body.method === 'initialize'
          ? { protocolVersion: MCP_PROTOCOL, capabilities: { tools: {} } }
          : { tools: definitions },
    })
  })
  vi.stubGlobal('fetch', fetcher)
  const discovered = await discoverMcp(
    call,
    env.CREDENTIAL_KEK_V1,
    server.serverId,
    credential.credentialId,
  )
  const tool = discovered.tools[0]
  if (!tool) throw new Error('Missing fixture tool')
  const selection = {
    serverId: server.serverId,
    credentialId: credential.credentialId,
    agentId,
    toolIds: [tool.toolId],
    catalogDigest: discovered.catalogDigest,
    readOnly: true as const,
  }
  return {
    call,
    server,
    credential,
    agentId,
    tool,
    selection,
    fetcher,
    change: (next: typeof definitions) => {
      definitions = next
    },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('MCP assignments', () => {
  it('never admits an MCP envelope into provider credential references', async () => {
    const { agentId, server, credential } = await fixture()
    const settings = await desiredSettings(agentId)
    await expect(
      validateCredentialRefs(management, {
        ...settings,
        credentials: {
          primary: { ...settings.credentials?.primary, [server.serverId]: credential.credentialId },
        },
      }),
    ).rejects.toThrow('invalid credential reference')
  })
  it('registration and inspection publish nothing; explicit assignment creates a pinned version', async () => {
    const { call, agentId, selection, tool } = await fixture()
    expect((await desiredSettings(agentId)).mcp).toBeUndefined()
    expect(
      await management.select().from(mcpAssignments).where(eq(mcpAssignments.agentId, agentId)),
    ).toEqual([])
    await expect(
      manageMcp(call, env.CREDENTIAL_KEK_V1, '', {
        operation: 'assign',
        ...selection,
        readOnly: false,
      }),
    ).rejects.toThrow()
    await assignMcp(call, env.CREDENTIAL_KEK_V1, selection)
    const settings = await desiredSettings(agentId)
    const selected = settings.mcp?.[0]
    if (!selected) throw new Error('Missing applied selection')
    expect(settings.tools).toContain(tool.modelName)
    expect(selected.digest).toBe(tool.digest)
    expect(await guardMcpSelection(management, agentId, selected)).toMatchObject({
      remoteName: 'read',
    })
  })

  it('keeps stable names but rejects changed definitions immediately without selecting additions', async () => {
    const { call, agentId, selection, tool, server, credential, change } = await fixture()
    await assignMcp(call, env.CREDENTIAL_KEK_V1, selection)
    const selected = (await desiredSettings(agentId)).mcp?.[0]
    if (!selected) throw new Error('Missing selection')
    change([
      {
        name: 'read',
        description: 'Changed external instructions',
        inputSchema: { type: 'object' },
      },
      { name: 'extra', description: 'New unselected tool', inputSchema: { type: 'object' } },
    ])
    await discoverMcp(call, env.CREDENTIAL_KEK_V1, server.serverId, credential.credentialId)
    const changed = await management
      .select()
      .from(mcpTools)
      .where(eq(mcpTools.toolId, tool.toolId))
      .get()
    expect(changed?.modelName).toBe(tool.modelName)
    expect(changed?.digest).not.toBe(tool.digest)
    await expect(guardMcpSelection(management, agentId, selected)).rejects.toThrow(
      'mcp_schema_changed',
    )
    expect((await desiredSettings(agentId)).mcp).toHaveLength(1)
  })

  it('rejects server invalidation and credential revocation without waiting for safe apply', async () => {
    const first = await fixture()
    await assignMcp(first.call, env.CREDENTIAL_KEK_V1, first.selection)
    const selected = (await desiredSettings(first.agentId)).mcp?.[0]
    if (!selected) throw new Error('Missing selection')
    await disableMcp(first.call, first.server.serverId)
    await expect(guardMcpSelection(management, first.agentId, selected)).rejects.toThrow()
    const second = await fixture()
    await assignMcp(second.call, env.CREDENTIAL_KEK_V1, second.selection)
    const other = (await desiredSettings(second.agentId)).mcp?.[0]
    if (!other) throw new Error('Missing selection')
    await disconnectMcp(
      management,
      env.CREDENTIAL_KEK_V1,
      second.server.serverId,
      second.credential.credentialId,
    )
    await expect(guardMcpSelection(management, second.agentId, other)).rejects.toThrow()
  })

  it('shares the installation catalog but still requires a separate explicit assignment per agent', async () => {
    const { call, server, selection } = await fixture()
    const otherAgentId = await newAgentId()
    await assignMcp(call, env.CREDENTIAL_KEK_V1, selection)
    expect(
      await management
        .select()
        .from(mcpAssignments)
        .where(
          and(
            eq(mcpAssignments.agentId, otherAgentId),
            eq(mcpAssignments.serverId, server.serverId),
          ),
        ),
    ).toEqual([])
    await assignMcp(call, env.CREDENTIAL_KEK_V1, { ...selection, agentId: otherAgentId })
    expect((await desiredSettings(otherAgentId)).mcp).toHaveLength(1)
    await expect(
      manageMcp(call, env.CREDENTIAL_KEK_V1, '', {
        operation: 'assign',
        ...selection,
        principalId: uuidv7(),
      }),
    ).rejects.toThrow()
  })
})
