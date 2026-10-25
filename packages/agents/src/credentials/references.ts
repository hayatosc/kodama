/** Current-version reverse indexes for credential invalidation. @module */
import { eq } from 'drizzle-orm'
import { agentCredentialRefs } from '../../drizzle/management/schema.ts'
import type { ManagementDb } from '../management/db.ts'
import type { AgentSettings } from '../protocol.ts'

/** Replace an agent's reverse index in the same batch as its configuration version. */
export function referenceStatements(
  db: ManagementDb,
  agentId: string,
  version: number,
  settings: AgentSettings,
) {
  const rows = Object.entries(settings.credentials?.primary ?? {}).map(
    ([provider, credentialId]) => ({ agentId, version, provider, credentialId }),
  )
  return [
    db.delete(agentCredentialRefs).where(eq(agentCredentialRefs.agentId, agentId)),
    ...rows.map((row) => db.insert(agentCredentialRefs).values(row)),
  ] as const
}
