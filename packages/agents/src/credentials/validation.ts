/** Validation of immutable credential references before configuration writes. @module */
import { and, eq } from 'drizzle-orm'
import { credentials, credentialGrants } from '../../drizzle/management/schema.ts'
import type { ManagementDb } from '../management/db.ts'
import type { AgentSettings } from '../protocol.ts'

/** Reject unknown, revoked, mismatched, or ungranted references without disclosing stored data. */
export async function validateCredentialRefs(
  db: ManagementDb,
  settings: AgentSettings,
  agentId?: string,
) {
  for (const refs of [settings.credentials?.primary, settings.credentials?.fallback]) {
    for (const [provider, credentialId] of Object.entries(refs ?? {})) {
      if (credentialId === null) continue
      const row = await db
        .select()
        .from(credentials)
        .where(eq(credentials.credentialId, credentialId))
        .get()
      if (
        !row ||
        row.status !== 'active' ||
        row.provider !== provider ||
        row.ownerScope !== 'installation'
      ) {
        throw new TypeError('credential_unavailable: invalid credential reference')
      }
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
}
