/** Current-version reverse indexes for credential invalidation. @module */
import type { ManagementDb } from '../control-plane/db.ts'
import { prepareQuery } from '../lib/reylo.ts'
import type { AgentSettings } from '../protocol.ts'
import deleteAgentCredentialRefs from './sql/delete-agent-credential-refs.sql'
import insertAgentCredentialRef from './sql/insert-agent-credential-ref.sql'
import insertCredentialGrantIgnore from './sql/insert-credential-grant-ignore.sql'

/** Initial grants for an authorized creation; include them in the registry creation batch. */
export function initialGrantStatements(
  db: ManagementDb,
  agentId: string,
  settings: AgentSettings,
): D1PreparedStatement[] {
  return [...new Set(Object.values(settings.credentials?.primary ?? {}))].map((credentialId) =>
    prepareQuery(db, insertCredentialGrantIgnore, { credentialId, agentId }),
  )
}

/** Replace an agent's reverse index in the same batch as its configuration version. */
export function referenceStatements(
  db: ManagementDb,
  agentId: string,
  settings: AgentSettings,
): D1PreparedStatement[] {
  const rows = Object.entries(settings.credentials?.primary ?? {}).map(
    ([provider, credentialId]) => ({ agentId, provider, credentialId }),
  )
  return [
    prepareQuery(db, deleteAgentCredentialRefs, { agentId }),
    ...rows.map((row) => prepareQuery(db, insertAgentCredentialRef, row)),
  ]
}
