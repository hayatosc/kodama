/** Current MCP states that require operator attention, projected into the existing inbox. @module */
import * as v from 'valibot'
import { and, eq, ne } from 'drizzle-orm'
import {
  agents,
  agentConfigVersions,
  credentials,
  credentialGrants,
  mcpAssignments,
  mcpServers,
  mcpTools,
} from '../../../drizzle/management/schema.ts'
import type { CompletionNotice } from '../../extensions.ts'
import type { ManagementDb } from '../../control-plane/db.ts'

/** Mark a notification-only catalog change; no network discovery or tool publication follows. */
export async function markMcpStale(db: ManagementDb, serverId: string, revision: number) {
  await db
    .update(mcpServers)
    .set({ stale: true })
    .where(and(eq(mcpServers.serverId, serverId), eq(mcpServers.revision, revision)))
}

/** Deduplication keys change only when the relevant registration or credential state changes. */
export async function mcpCatalogNotices(
  db: ManagementDb,
  agentId: string,
  serverId: string,
): Promise<CompletionNotice[]> {
  const rows = await db
    .select({
      assignment: mcpAssignments,
      server: mcpServers,
      tool: mcpTools,
      credential: credentials,
      grant: credentialGrants,
    })
    .from(mcpAssignments)
    .innerJoin(mcpServers, eq(mcpServers.serverId, mcpAssignments.serverId))
    .innerJoin(mcpTools, eq(mcpTools.toolId, mcpAssignments.toolId))
    .innerJoin(credentials, eq(credentials.credentialId, mcpAssignments.credentialId))
    .leftJoin(
      credentialGrants,
      and(
        eq(credentialGrants.credentialId, mcpAssignments.credentialId),
        eq(credentialGrants.agentId, mcpAssignments.agentId),
      ),
    )
    .where(and(eq(mcpAssignments.agentId, agentId), eq(mcpAssignments.serverId, serverId)))
  const notices = new Map<string, CompletionNotice>()
  for (const { assignment, server, tool, credential, grant } of rows) {
    const reason =
      !server.enabled || server.revision !== assignment.serverRevision
        ? 'server_disabled'
        : !tool.present || tool.digest !== assignment.digest || tool.rejection
          ? 'schema_changed'
          : credential.status !== 'active' || !grant
            ? (credential.mcpAuthState ?? 'credential_unavailable')
            : server.stale
              ? 'catalog_stale'
              : undefined
    if (!reason) continue
    const sourceId = `${serverId}:${server.revision}:${server.catalogVersion}:${credential.credentialId}:${credential.revision}:${reason}`
    notices.set(sourceId, {
      source: 'mcp',
      sourceId,
      outcome: 'failed',
      summary: `MCP server ${serverId} requires operator attention: ${reason}. No tools were automatically added or retried.`,
      artifactIds: [],
    })
  }
  return [...notices.values()]
}

/** Local revocation remains reportable after its assignment and grant indexes have been removed. */
export async function mcpCredentialNotice(
  db: ManagementDb,
  agentId: string,
  credentialId: string,
): Promise<CompletionNotice | undefined> {
  const row = await db
    .select({ credential: credentials })
    .from(credentials)
    .innerJoin(agents, and(eq(agents.agentId, agentId), eq(agents.kind, 'working')))
    .where(
      and(
        eq(agents.agentId, agentId),
        eq(credentials.credentialId, credentialId),
        eq(credentials.purpose, 'mcp_server'),
      ),
    )
    .get()
  if (!row || row.credential.status === 'active') return undefined
  return {
    source: 'mcp',
    sourceId: `${credentialId}:${row.credential.revision}:${row.credential.status}`,
    outcome: 'failed',
    summary: `MCP credential ${credentialId} is unavailable (${row.credential.mcpAuthState ?? row.credential.status}). The operator must reconnect or remove its selections; no call was retried.`,
    artifactIds: [],
  }
}

/** Recover revocation delivery after its live assignment index has already been removed. */
export async function mcpRevocationRecipients(db: ManagementDb) {
  const rows = await db
    .select({
      agentId: agents.agentId,
      credentialId: credentials.credentialId,
      settingsJson: agentConfigVersions.settingsJson,
    })
    .from(credentials)
    .innerJoin(agents, eq(agents.kind, 'working'))
    .innerJoin(
      agentConfigVersions,
      and(
        eq(agentConfigVersions.agentId, agents.agentId),
        eq(agentConfigVersions.version, agents.currentVersion),
      ),
    )
    .where(and(eq(credentials.purpose, 'mcp_server'), ne(credentials.status, 'active')))
  const schema = v.object({ mcp: v.optional(v.array(v.object({ credentialId: v.string() }))) })
  return rows
    .filter((row) => {
      const parsed: unknown = JSON.parse(row.settingsJson)
      const result = v.safeParse(schema, parsed)
      return (
        result.success &&
        result.output.mcp?.some((selection) => selection.credentialId === row.credentialId)
      )
    })
    .map(({ agentId, credentialId }) => ({ agentId, credentialId }))
}

/** Recipients are explicit assignment holders, never all registered agents. */
export async function mcpNoticeRecipients(db: ManagementDb, serverId?: string) {
  return db
    .selectDistinct({ agentId: mcpAssignments.agentId, serverId: mcpAssignments.serverId })
    .from(mcpAssignments)
    .where(serverId ? eq(mcpAssignments.serverId, serverId) : undefined)
}
