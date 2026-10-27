/** Validate supplied credential references before immutable configuration writes. @module */
import { eq } from 'drizzle-orm'
import { credentials } from '../../drizzle/management/schema.ts'
import type { ManagementDb } from '../management/db.ts'
import type { AgentSettings } from '../protocol.ts'

/** Reject unknown, inactive or provider-mismatched references before any database mutation. */
export async function validateCredentialRefs(db: ManagementDb, settings: AgentSettings) {
  for (const [provider, credentialId] of Object.entries(settings.credentials?.primary ?? {})) {
    const row = await db
      .select()
      .from(credentials)
      .where(eq(credentials.credentialId, credentialId))
      .get()
    if (!row)
      throw new TypeError(
        'credential_unavailable: invalid credential reference (Unknown credential)',
      )
    if (row.status !== 'active' || row.provider !== provider)
      throw new TypeError('credential_unavailable: invalid credential reference')
  }
}
