/** Local-only owner bootstrap; this module is reachable only from the development entrypoint. @module */
import { eq } from 'drizzle-orm'
import * as v from 'valibot'
import { principals } from '../drizzle/management/schema.ts'
import type { ManagementEnv } from '../src/management/service/agents.ts'
import type { KekEnv } from '../src/credentials/keys.ts'
import type { CredentialRefs, SeedResult } from '../src/protocol.ts'
import { managementDb } from '../src/management/db.ts'
import { principalOf } from '../src/management/principals.ts'
import { createAgentModels } from '../src/models/index.ts'
import { putCredential } from '../src/credentials/management.ts'
import { assignCredential } from '../src/credentials/assignments.ts'
import { sha256Hex } from '../src/lib/hash.ts'

const schema = v.record(
  v.picklist(['openai', 'anthropic', 'google', 'xai']),
  v.pipe(v.string(), v.minLength(8), v.maxLength(16384)),
)

/** Read keys from an authenticated local request, register them, then seed/assign both agent kinds. */
export async function seedLocalCredentials(
  env: ManagementEnv & KekEnv,
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
  await db
    .update(principals)
    .set({ systemRole: 'owner' })
    .where(eq(principals.principalId, principal.principalId))
  const call = {
    db,
    env,
    now,
    models: createAgentModels(),
    principal: { ...principal, systemRole: 'owner' as const },
  }
  const primary: Record<string, string> = {}
  for (const [provider, secret] of Object.entries(parsed.output)) {
    if (!secret) continue
    const row = await putCredential(call, env, {
      requestId: `dev:${provider}:${await sha256Hex(secret)}`,
      provider,
      secret,
    })
    primary[provider] = row.credentialId
  }
  const seeded = await seed({ primary, fallback: {} })
  for (const id of Object.values(primary)) await assignCredential(call, id, 'all')
  return { seeded, credentials: primary }
}
