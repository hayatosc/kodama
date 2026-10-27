/** Validation of immutable credential references before configuration writes. @module */
import * as v from 'valibot'
import { UUID_PATTERN } from '../lib/uuid.ts'
import { parseInput } from '../validation.ts'
import { and, eq } from 'drizzle-orm'
import { credentials, credentialGrants } from '../../drizzle/management/schema.ts'
import type { ManagementDb } from '../management/db.ts'
import type { AgentSettings, CredentialRefs } from '../protocol.ts'

/** Resolve explicitly supplied credential IDs from metadata; never choose an implicit credential. */
export function selectedCredentialRefs(
  input: unknown,
  rows: readonly { credentialId: string; provider: string; status: string }[],
): CredentialRefs | undefined {
  const { credentialIds } = parseInput(
    v.object({ credentialIds: v.optional(v.array(v.pipe(v.string(), v.regex(UUID_PATTERN)))) }),
    input,
  )
  if (credentialIds === undefined) return undefined
  const primary: Record<string, string> = {}
  for (const id of credentialIds) {
    const row = rows.find((candidate) => candidate.credentialId === id)
    if (!row || row.status !== 'active') throw new TypeError('Unknown or inactive credential')
    if (Object.hasOwn(primary, row.provider))
      throw new TypeError('Choose one credential per provider')
    primary[row.provider] = id
  }
  return { primary }
}

/** All credential kinds use the same status, provider and grant rules; ownership is metadata. */
export async function validateCredentialRefs(
  db: ManagementDb,
  settings: AgentSettings,
  agentId?: string,
) {
  if (!settings.credentials?.primary[settings.model.provider])
    throw new TypeError(
      `credential_unavailable: missing credential reference for ${settings.model.provider}`,
    )
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
