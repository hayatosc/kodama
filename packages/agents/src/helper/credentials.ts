/** Fake credentials registered into D1 for tests; never imported by production code. @module */
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { principals } from '../../drizzle/management/schema.ts'
import { managementDb } from '../management/db.ts'
import { principalOf } from '../management/principals.ts'
import { createAgentModels } from '../models/index.ts'
import { putCredential, grantCredential } from '../credentials/management.ts'
import type { CredentialRefs } from '../protocol.ts'

const db = managementDb(env.MANAGEMENT_DB)

/** An installation-owner call, independent of agent seeding. */
export async function credentialOwnerCall() {
  const principal = await principalOf(
    db,
    { kind: 'user', externalId: 'tester@example.com' },
    Date.now(),
  )
  await db
    .update(principals)
    .set({ systemRole: 'owner' })
    .where(eq(principals.principalId, principal.principalId))
  return {
    db,
    env,
    models: createAgentModels(env),
    now: Date.now(),
    principal: { ...principal, systemRole: 'owner' as const },
  }
}

/** Stable fake keys retain the auth headers expected by the mocked providers. */
export async function testCredentialRefs(): Promise<CredentialRefs> {
  const call = await credentialOwnerCall()
  const primary: Record<string, string> = {}
  for (const [provider, secret] of [
    ['openai', 'test-key'],
    ['xai', 'xai-test-key'],
  ] as const) {
    const row = await putCredential(call, env, { requestId: `test-${provider}`, provider, secret })
    primary[provider] = row.credentialId
  }
  return { primary, fallback: {} }
}

/** Explicitly grant a test agent its fake keys. */
export async function grantTestCredentials(agentId: string) {
  const call = await credentialOwnerCall()
  const refs = await testCredentialRefs()
  for (const credentialId of Object.values(refs.primary))
    await grantCredential(call, credentialId, agentId)
  return refs
}
