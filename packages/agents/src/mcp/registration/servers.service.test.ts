/** MCP catalog and assignment workflows against real local D1, with remote transport fixtures. @module */
import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { createAgentModels } from '../../control-plane/models.ts'
import { validateCredentialRefs } from '../../credentials/validation.ts'
import { uuidv7 } from '../../lib/uuid.ts'
import {
  desiredSettings,
  management,
  newAgentId,
  updateSettings,
} from '../../testing/management.ts'
import {
  listMcpAssignmentsByAgent,
  listMcpAssignmentsByAgentServer,
} from '../../testing/test-db.repository.ts'
import { disconnectMcp } from '../authorization/refresh.service.ts'
import { putMcpBearer } from '../authorization/vault.service.ts'
import { MCP_PROTOCOL } from '../connection/transport.ts'
import { findMcpToolById } from './catalog.repository.ts'
import { guardMcpSelection, mcpServer, registerMcpCatalog } from './catalog.service.ts'
import { mcpCatalogNotices } from './notifications.service.ts'
import { manageMcp } from './operations.service.ts'
import { assignMcp, disableMcp, discoverMcp } from './servers.service.ts'

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
  let listChanged = false
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
    if (options?.method === 'DELETE') return new Response(null, { status: 204 })
    const body: unknown = JSON.parse(typeof options?.body === 'string' ? options.body : '{}')
    if (!body || typeof body !== 'object' || !('method' in body))
      throw new Error('Bad fixture request')
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 })
    if (!('id' in body)) throw new Error('Missing fixture ID')
    const result = {
      jsonrpc: '2.0',
      id: body.id,
      result:
        body.method === 'initialize'
          ? { protocolVersion: MCP_PROTOCOL, capabilities: { tools: {} } }
          : { tools: definitions },
    }
    if (listChanged && body.method === 'tools/list')
      return new Response(
        `data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })}\n\ndata: ${JSON.stringify(result)}\n\n`,
        { headers: { 'Content-Type': 'text/event-stream' } },
      )
    return Response.json(result)
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
    setListChanged: (value: boolean) => {
      listChanged = value
    },
    change: (next: typeof definitions) => {
      definitions = next
    },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('MCP assignments', () => {
  it('preserves discovery list-change notices without rediscovery or changing assignments', async () => {
    const { call, agentId, selection, server, credential, fetcher, setListChanged } =
      await fixture()
    await assignMcp(call, env.CREDENTIAL_KEK_V1, selection)
    const settings = await desiredSettings(agentId)
    setListChanged(true)
    fetcher.mockClear()
    await discoverMcp(call, env.CREDENTIAL_KEK_V1, server.serverId, credential.credentialId)
    expect((await mcpServer(management, server.serverId)).stale).toBe(true)
    expect(await mcpCatalogNotices(management, agentId, server.serverId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ summary: expect.stringContaining('catalog_stale') }),
      ]),
    )
    expect(await desiredSettings(agentId)).toEqual(settings)
    expect(fetcher).toHaveBeenCalledTimes(3)
    setListChanged(false)
    await discoverMcp(call, env.CREDENTIAL_KEK_V1, server.serverId, credential.credentialId)
    expect((await mcpServer(management, server.serverId)).stale).toBe(false)
  })

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
    expect(await listMcpAssignmentsByAgent(management, { agentId })).toEqual([])
    await expect(
      manageMcp(call, env.CREDENTIAL_KEK_V1, '', {
        operation: 'assign',
        ...selection,
        toolIds: [],
      }),
    ).rejects.toThrow()
    await manageMcp(call, env.CREDENTIAL_KEK_V1, '', {
      operation: 'assign',
      ...selection,
      readOnly: false,
    })
    expect((await desiredSettings(agentId)).toolPolicy?.[tool.modelName]).toBe('ask')
    await assignMcp(call, env.CREDENTIAL_KEK_V1, selection)
    const settings = await desiredSettings(agentId)
    const selected = settings.mcp?.[0]
    if (!selected) throw new Error('Missing applied selection')
    expect(settings.tools).toContain(tool.modelName)
    expect(settings.toolPolicy?.[tool.modelName]).toBeUndefined()
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
    const changed = await findMcpToolById(management, tool.toolId)
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
      await listMcpAssignmentsByAgentServer(management, {
        agentId: otherAgentId,
        serverId: server.serverId,
      }),
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

  it('preserves explicit deny policies across both read-only and read-write reassignments while dropping unselected tools', async () => {
    const { call, agentId, server, credential, change } = await fixture()
    change([
      { name: 'read', description: 'Read records', inputSchema: { type: 'object' } },
      { name: 'drop_me', description: 'Removed tool', inputSchema: { type: 'object' } },
    ])
    const initialDiscovery = await discoverMcp(
      call,
      env.CREDENTIAL_KEK_V1,
      server.serverId,
      credential.credentialId,
    )
    const readTool = initialDiscovery.tools.find((t) => t.remoteName === 'read')
    const dropTool = initialDiscovery.tools.find((t) => t.remoteName === 'drop_me')
    if (!readTool || !dropTool) throw new Error('Missing fixture tools')

    await manageMcp(call, env.CREDENTIAL_KEK_V1, '', {
      operation: 'assign',
      serverId: server.serverId,
      credentialId: credential.credentialId,
      agentId,
      toolIds: [readTool.toolId, dropTool.toolId],
      catalogDigest: initialDiscovery.catalogDigest,
      readOnly: false,
    })

    await updateSettings(agentId, {
      toolPolicy: {
        [readTool.modelName]: 'deny',
        [dropTool.modelName]: 'deny',
      },
    })

    // Reassign as readOnly: true with only readTool selected: deny on readTool must survive.
    await manageMcp(call, env.CREDENTIAL_KEK_V1, '', {
      operation: 'assign',
      serverId: server.serverId,
      credentialId: credential.credentialId,
      agentId,
      toolIds: [readTool.toolId],
      catalogDigest: initialDiscovery.catalogDigest,
      readOnly: true,
    })
    let settings = await desiredSettings(agentId)
    expect(settings.toolPolicy?.[readTool.modelName]).toBe('deny')
    expect(settings.toolPolicy?.[dropTool.modelName]).toBeUndefined()

    // Reassign as readOnly: false: explicit deny must not relax to 'ask'.
    await manageMcp(call, env.CREDENTIAL_KEK_V1, '', {
      operation: 'assign',
      serverId: server.serverId,
      credentialId: credential.credentialId,
      agentId,
      toolIds: [readTool.toolId],
      catalogDigest: initialDiscovery.catalogDigest,
      readOnly: false,
    })
    settings = await desiredSettings(agentId)
    expect(settings.toolPolicy?.[readTool.modelName]).toBe('deny')
  })
})
