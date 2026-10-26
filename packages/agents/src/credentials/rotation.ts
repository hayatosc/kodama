/** Atomic provider-key replacement and configuration-version fan-out. @module */
import { and, eq } from 'drizzle-orm'
import * as v from 'valibot'
import {
  agents,
  agentCredentialRefs,
  credentials,
  credentialGrants,
} from '../../drizzle/management/schema.ts'
import type { ManagementCall } from '../management/service/agents.ts'
import { pushDesired } from '../management/service/agents.ts'
import { parseSettings } from '../configuration/index.ts'
import { versionRow, writeVersionStatements } from '../management/versions.ts'
import { auditByOpId, auditStatement } from '../management/audit.ts'
import { uuidv7 } from '../lib/uuid.ts'
import { sha256Hex } from '../lib/hash.ts'
import { credentialRow, credentialActor } from './management.ts'
import { credentialInsert, credentialMetadata } from './vault.ts'
import type { KekEnv } from './keys.ts'
import { activeKek, guardKekVersion } from './keys.ts'
import { invalidateCredential } from './invalidation.ts'

const inputSchema = v.object({
  requestId: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
  secret: v.pipe(v.string(), v.minLength(8), v.maxLength(16384)),
})

/** Replace either credential kind without changing its scope; retries resume configuration pushes. */
export async function rotateCredential(
  call: ManagementCall,
  env: KekEnv,
  oldId: string,
  request: unknown,
) {
  const principal = credentialActor(call)
  const parsed = v.safeParse(inputSchema, request)
  if (!parsed.success) throw new TypeError('Invalid credential rotation')
  const old = await credentialRow(call, oldId)
  const opId = `credential.rotate:${oldId}:${parsed.output.requestId}`
  const previous = await auditByOpId(call.db, opId)
  let credentialId = previous?.targetId
  if (!credentialId) {
    if (old.status !== 'active') throw new Error('credential_unavailable: credential is not active')
    credentialId = uuidv7(call.now)
    const nextId = credentialId
    const encryption = await activeKek(call.db, env)
    const { statement } = await credentialInsert(
      call.db,
      {
        credentialId,
        revision: 1,
        kind: old.kind,
        provider: old.provider,
        ownerId: old.ownerId,
      },
      parsed.output.secret,
      encryption.key,
      call.now,
      encryption.version,
    )
    const targets = await call.db
      .selectDistinct({ agent: agents })
      .from(agentCredentialRefs)
      .innerJoin(agents, eq(agents.agentId, agentCredentialRefs.agentId))
      .where(eq(agentCredentialRefs.credentialId, oldId))
    const changes = await Promise.all(
      targets.map(async ({ agent }) => {
        const version = await versionRow(call.db, agent.agentId, agent.currentVersion)
        if (!version) throw new Error('Agent has no configuration')
        const settings = parseSettings(call.models, JSON.parse(version.settingsJson))
        if (settings.credentials?.primary[old.provider] === oldId)
          settings.credentials.primary[old.provider] = nextId
        return writeVersionStatements(
          call.db,
          { actorId: principal.principalId, now: call.now, opId: uuidv7() },
          agent.agentId,
          agent.currentVersion,
          settings,
          { comment: 'Credential rotated' },
        )
      }),
    )
    await call.db.batch([
      statement,
      guardKekVersion(call.db, encryption.version),
      call.db
        .update(credentials)
        .set({ status: 'retiring' })
        .where(and(eq(credentials.credentialId, oldId), eq(credentials.status, 'active'))),
      ...targets.map(({ agent }) =>
        call.db
          .insert(credentialGrants)
          .values({ credentialId: nextId, agentId: agent.agentId })
          .onConflictDoNothing(),
      ),
      ...changes.flat(),
      auditStatement(call.db, {
        opId,
        at: call.now,
        actorId: principal.principalId,
        action: 'credential.rotate',
        targetKind: 'system',
        targetId: credentialId,
        detail: {
          previousCredentialId: oldId,
          kind: old.kind,
          provider: old.provider,
          fingerprint: await sha256Hex(parsed.output.secret),
        },
      }),
    ])
  }
  const current = await credentialRow(call, credentialId)
  if (current.fingerprint !== (await sha256Hex(parsed.output.secret)))
    throw new Error('credential_conflict')
  await invalidateCredential(call, credentialId)
  const refs = await call.db
    .selectDistinct({ agentId: agentCredentialRefs.agentId })
    .from(agentCredentialRefs)
    .where(eq(agentCredentialRefs.credentialId, credentialId))
  const applied = await Promise.all(
    refs.map(async ({ agentId }) => (await pushDesired(call, agentId)).state),
  )
  return {
    ...credentialMetadata(current),
    complete: applied.every((state) => state === 'applied' || state === 'stale'),
  }
}
