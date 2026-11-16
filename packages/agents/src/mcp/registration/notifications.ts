/** Current MCP states that require operator attention, projected into the existing inbox. @module */
import * as v from 'valibot'
import type { ManagementDb } from '../../control-plane/db.ts'
import type { CompletionNotice } from '../../extensions.ts'
import markMcpServerStale from './sql/mark-mcp-server-stale.sql'
import selectMcpCatalogNotices from './sql/select-mcp-catalog-notices.sql'
import selectMcpCredentialNotice from './sql/select-mcp-credential-notice.sql'
import selectMcpNoticeRecipients from './sql/select-mcp-notice-recipients.sql'
import selectMcpRevocationRecipients from './sql/select-mcp-revocation-recipients.sql'

/** Mark a notification-only catalog change; no network discovery or tool publication follows. */
export async function markMcpStale(db: ManagementDb, serverId: string, revision: number) {
  await markMcpServerStale.run(db, { serverId, revision })
}

/** Deduplication keys change only when the relevant registration or credential state changes. */
export async function mcpCatalogNotices(
  db: ManagementDb,
  agentId: string,
  serverId: string,
): Promise<CompletionNotice[]> {
  const rows = await selectMcpCatalogNotices.run(db, { agentId, serverId })
  const notices = new Map<string, CompletionNotice>()
  for (const row of rows) {
    const reason =
      !row.serverEnabled || row.serverRevision !== row.assignmentServerRevision
        ? 'server_disabled'
        : !row.toolPresent || row.toolDigest !== row.assignmentDigest || row.toolRejection
          ? 'schema_changed'
          : row.credentialStatus !== 'active' || !row.grantCredentialId
            ? (row.credentialMcpAuthState ?? 'credential_unavailable')
            : row.serverStale
              ? 'catalog_stale'
              : undefined
    if (!reason) continue
    const sourceId = `${serverId}:${row.serverRevision}:${row.serverCatalogVersion}:${row.credentialId}:${row.credentialRevision}:${reason}`
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
  const row = await selectMcpCredentialNotice.run(db, { agentId, credentialId })
  if (!row || row.status === 'active') return undefined
  return {
    source: 'mcp',
    sourceId: `${credentialId}:${row.revision}:${row.status}`,
    outcome: 'failed',
    summary: `MCP credential ${credentialId} is unavailable (${row.mcpAuthState ?? row.status}). The operator must reconnect or remove its selections; no call was retried.`,
    artifactIds: [],
  }
}

/** Recover revocation delivery after its live assignment index has already been removed. */
export async function mcpRevocationRecipients(db: ManagementDb) {
  const rows = await selectMcpRevocationRecipients.run(db)
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
  return selectMcpNoticeRecipients.run(db, { serverId: serverId ?? null })
}
