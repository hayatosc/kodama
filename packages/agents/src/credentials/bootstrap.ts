/** Local-only registration through the same credential operations as trusted RPC callers. @module */
import * as v from 'valibot'
import type { ManagementEnv } from '../control-plane/workflows/agents.ts'
import type { AgentEnv } from '../env.ts'
import type { CredentialRefs, SeedResult } from '../protocol.ts'
import { managementDb } from '../control-plane/db.ts'
import { principalOf } from '../control-plane/principals.ts'
import { createAgentModels } from '../control-plane/models.ts'
import { putCredential } from './management.ts'
import { credentialFingerprint } from './encryption.ts'

const schema = v.record(
  v.picklist(['openai', 'anthropic', 'google', 'xai']),
  v.pipe(v.string(), v.minLength(8), v.maxLength(16384)),
)

/** Read keys from an authenticated local request, register them, then seed/assign both agent kinds. */
export async function seedLocalCredentials(
  env: ManagementEnv & Pick<AgentEnv, 'CREDENTIAL_KEK_V1'>,
  request: Request,
  seed: (refs: CredentialRefs) => Promise<SeedResult>,
) {
  let input: unknown
  try {
    input = await request.json()
  } catch {
    throw new TypeError('Invalid credential JSON')
  }
  const parsed = v.safeParse(schema, input)
  if (!parsed.success || !Object.keys(parsed.output).length)
    throw new TypeError('Expected a nonempty provider-to-key JSON object')
  const db = managementDb(env.MANAGEMENT_DB)
  const now = Date.now()
  const principal = await principalOf(db, { kind: 'service', externalId: 'kodama-dev-cli' }, now)
  const call = {
    db,
    env,
    now,
    models: createAgentModels(),
    principal,
  }
  const primary: Record<string, string> = {}
  for (const [provider, secret] of Object.entries(parsed.output)) {
    if (!secret) continue
    const row = await putCredential(call, env, {
      requestId: `dev_${provider}_${await credentialFingerprint(secret, env.CREDENTIAL_KEK_V1)}`,
      provider,
      secret,
    })
    primary[provider] = row.credentialId
  }
  const seeded = await seed({ primary })
  return { seeded, credentials: primary }
}
