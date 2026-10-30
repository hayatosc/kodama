/** Fake credentials registered into D1 for tests; never imported by production code. @module */
import { env } from 'cloudflare:workers'
import { managementDb } from '../control-plane/db.ts'
import { principalOf } from '../control-plane/principals.ts'
import { createAgentModels } from '../control-plane/models.ts'
import { putCredential, grantCredential } from '../credentials/management.ts'
import { defaultAgentSettings } from '../control-plane/config.ts'
import { createCredentialStore } from '../credentials/store.ts'
import type { CredentialRefs } from '../protocol.ts'

const db = managementDb(env.MANAGEMENT_DB)

/** A regular registered caller, independent of agent seeding. */
export async function credentialCall() {
  const principal = await principalOf(
    db,
    { kind: 'user', externalId: 'tester@example.com' },
    Date.now(),
  )
  return { db, env, models: createAgentModels(), now: Date.now(), principal }
}

/** Stable fake keys retain the auth headers expected by the mocked providers. */
export async function testCredentialRefs(): Promise<CredentialRefs> {
  const call = await credentialCall()
  const primary: Record<string, string> = {}
  for (const [provider, secret] of [
    ['openai', 'test-key'],
    ['xai', 'xai-test-key'],
  ] as const) {
    const row = await putCredential(call, env, { requestId: `test-${provider}`, provider, secret })
    primary[provider] = row.credentialId
  }
  return { primary }
}

/** Supply an isolated harness with the same D1 mechanism as an agent. */
export async function testCredentialStore(agentId: string) {
  const refs = await grantTestCredentials(agentId)
  return createCredentialStore(
    db,
    async () => agentId,
    async () => ({ ...defaultAgentSettings(env), credentials: refs }),
    () => env.CREDENTIAL_KEK_V1,
  ).store
}

/** Explicitly grant a test agent its fake keys. */
export async function grantTestCredentials(agentId: string) {
  const call = await credentialCall()
  const refs = await testCredentialRefs()
  for (const credentialId of Object.values(refs.primary))
    await grantCredential(call, credentialId, agentId)
  return refs
}
