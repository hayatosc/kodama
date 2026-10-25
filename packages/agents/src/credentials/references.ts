/** Current-version reverse indexes for credential invalidation. @module */
import { eq } from 'drizzle-orm'
import { agentCredentialRefs, credentialGrants } from '../../drizzle/management/schema.ts'
import type { ManagementDb } from '../management/db.ts'
import type { AgentSettings } from '../protocol.ts'

/** Initial grants for an authorized creation; include them in the registry creation batch. */
export function initialGrantStatements(
  db: ManagementDb,
  agentId: string,
  settings: AgentSettings,
  now: number,
) {
  return [...new Set(Object.values(settings.credentials?.primary ?? {}))].map((credentialId) =>
    db
      .insert(credentialGrants)
      .values({ credentialId, agentId, createdAt: now })
      .onConflictDoNothing(),
  )
}

/** Replace an agent's reverse index in the same batch as its configuration version. */
export function referenceStatements(db: ManagementDb, agentId: string, settings: AgentSettings) {
  const rows = Object.entries(settings.credentials?.primary ?? {}).map(
    ([provider, credentialId]) => ({ agentId, provider, credentialId }),
  )
  return [
    db.delete(agentCredentialRefs).where(eq(agentCredentialRefs.agentId, agentId)),
    ...rows.map((row) => db.insert(agentCredentialRefs).values(row)),
  ] as const
}
