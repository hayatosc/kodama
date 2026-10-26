/** Validation of immutable credential references before configuration writes. @module */
import { and, eq } from 'drizzle-orm'
import { credentials, credentialGrants } from '../../drizzle/management/schema.ts'
import type { ManagementDb } from '../management/db.ts'
import type { AgentSettings } from '../protocol.ts'

/** All credential kinds use the same status, provider and grant rules; ownership is metadata. */
export async function validateCredentialRefs(
  db: ManagementDb,
  settings: AgentSettings,
  agentId?: string,
) {
  for (const [provider, credentialId] of Object.entries(settings.credentials?.primary ?? {})) {
    const row = await db
      .select()
      .from(credentials)
      .where(eq(credentials.credentialId, credentialId))
      .get()
    if (!row || row.status !== 'active' || row.provider !== provider)
      throw new TypeError('credential_unavailable: invalid credential reference')
    if (agentId) {
      const grant = await db
        .select()
        .from(credentialGrants)
        .where(
          and(
            eq(credentialGrants.agentId, agentId),
            eq(credentialGrants.credentialId, credentialId),
          ),
        )
        .get()
      if (!grant)
        throw new TypeError('credential_unavailable: credential is not granted to the agent')
    }
  }
}
