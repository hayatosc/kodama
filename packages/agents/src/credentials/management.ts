/**
 * Credential management with the same caller rules as other management RPC. RPC inputs and results never expose stored envelopes.
 * Revocation remains incomplete until its durable R2 tombstone exists.
 *
 * @module
 */
import { and, eq } from 'drizzle-orm'
import * as v from 'valibot'
import {
  credentials,
  credentialGrants,
  agentCredentialRefs,
} from '../../drizzle/management/schema.ts'
import type { AgentEnv } from '../env.ts'
import type { ManagementCall } from '../management/service/agents.ts'
import { auditByOpId, auditStatement } from '../management/audit.ts'
import { uuidv7 } from '../lib/uuid.ts'
import { sha256Hex } from '../lib/hash.ts'
import { parseAgentId } from '../validation.ts'
import { credentialInsert, credentialMetadata } from './vault.ts'

/** Require the registered caller used by management, without credential-specific roles. */
export function credentialActor(call: ManagementCall) {
  if (!call.principal || call.principal.disabledAt !== null)
    throw new Error('forbidden: a registered active caller is required')
  return call.principal
}

const putSchema = v.object({
  kind: v.optional(v.picklist(['api_key', 'oauth_subscription']), 'api_key'),
  requestId: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
  provider: v.pipe(v.string(), v.regex(/^[a-z][a-z0-9-]{0,63}$/)),
  secret: v.pipe(v.string(), v.minLength(8), v.maxLength(16384)),
  ownerScope: v.optional(v.picklist(['installation', 'principal']), 'installation'),
})

/** Register either credential kind atomically with its audit row; secret parsing errors contain no values. */
export async function putCredential(
  call: ManagementCall,
  env: Pick<AgentEnv, 'CREDENTIAL_KEK_V1'>,
  request: unknown,
) {
  const principal = credentialActor(call)
  const parsed = v.safeParse(putSchema, request)
  if (!parsed.success) throw new TypeError('Invalid credential registration')
  const input = parsed.output
  const opId = `credential.put:${principal.principalId}:${input.requestId}`
  const previous = await auditByOpId(call.db, opId)
  if (previous) {
    const row = await credentialRow(call, previous.targetId)
    if (
      row.kind !== input.kind ||
      row.provider !== input.provider ||
      row.ownerScope !== input.ownerScope ||
      row.fingerprint !== (await sha256Hex(input.secret))
    )
      throw new Error('credential_conflict')
    return credentialMetadata(row)
  }
  const credentialId = uuidv7(call.now)
  const { statement } = await credentialInsert(
    call.db,
    {
      credentialId,
      kind: input.kind,
      provider: input.provider,
      ownerScope: input.ownerScope,
      ownerId: input.ownerScope === 'principal' ? principal.principalId : null,
      revision: 1,
    },
    input.secret,
    env.CREDENTIAL_KEK_V1,
    call.now,
  )
  // The prepared insert contains ciphertext only. The audit never includes an input object.
  const [rows] = await call.db.batch([
    statement,
    auditStatement(call.db, {
      opId,
      at: call.now,
      actorId: principal.principalId,
      action: 'credential.put',
      targetKind: 'system',
      targetId: credentialId,
      detail: {
        kind: input.kind,
        provider: input.provider,
        fingerprint: await sha256Hex(input.secret),
      },
    }),
  ])
  const row = rows[0]
  if (!row) throw new Error('credential_unavailable: registration failed')
  return credentialMetadata(row)
}

/** List metadata only; envelopes are never part of this result. */
export async function listCredentials(call: ManagementCall) {
  credentialActor(call)
  return (await call.db.select().from(credentials)).map(credentialMetadata)
}

/** Read one credential after authorization, rejecting unknown IDs. */
export async function credentialRow(call: ManagementCall, id: string) {
  credentialActor(call)
  const row = await call.db
    .select()
    .from(credentials)
    .where(eq(credentials.credentialId, parseAgentId(id)))
    .get()
  if (!row) throw new TypeError('Unknown credential')
  return row
}

/** Show the affected agents before a caller chooses to revoke a credential. */
export async function credentialCoverage(call: ManagementCall, credentialId: string) {
  const row = await credentialRow(call, credentialId)
  const references = await call.db
    .select()
    .from(agentCredentialRefs)
    .where(eq(agentCredentialRefs.credentialId, credentialId))
  const grants = await call.db
    .select()
    .from(credentialGrants)
    .where(eq(credentialGrants.credentialId, credentialId))
  return {
    credential: credentialMetadata(row),
    references,
    agents: grants.map((grant) => grant.agentId),
  }
}

/** Grant permission without changing a version; assignment is a separate atomic operation. */
export async function grantCredential(call: ManagementCall, credentialId: string, agentId: string) {
  const principal = credentialActor(call)
  const row = await credentialRow(call, credentialId)
  parseAgentId(agentId)
  if (row.status !== 'active' && row.status !== 'retiring')
    throw new Error('credential_unavailable: inactive credential')
  const existing = await call.db
    .select()
    .from(credentialGrants)
    .where(
      and(eq(credentialGrants.credentialId, credentialId), eq(credentialGrants.agentId, agentId)),
    )
    .get()
  if (!existing)
    await call.db.batch([
      call.db.insert(credentialGrants).values({ credentialId, agentId, createdAt: call.now }),
      auditStatement(call.db, {
        opId: uuidv7(),
        at: call.now,
        actorId: principal.principalId,
        action: 'credential.grant',
        targetKind: 'agent',
        targetId: agentId,
        detail: {
          credentialId,
          kind: row.kind,
          provider: row.provider,
          fingerprint: row.fingerprint,
        },
      }),
    ])
  return { credentialId, agentId }
}

/** Disable first, then persist a retryable tombstone; never report success before R2 acknowledges. */
export async function revokeCredential(
  call: ManagementCall,
  env: Pick<AgentEnv, 'CREDENTIAL_BACKUPS'>,
  credentialId: string,
) {
  const principal = credentialActor(call)
  const row = await credentialRow(call, credentialId)
  const coverage = await credentialCoverage(call, credentialId)
  if (row.status !== 'revoked')
    await call.db.batch([
      call.db
        .update(credentials)
        .set({
          status: 'revoked',
          ciphertext: null,
          iv: null,
          wrappedDek: null,
          wrapIv: null,
          revokedAt: call.now,
          leaseId: null,
          leaseExpiresAt: null,
        })
        .where(eq(credentials.credentialId, credentialId)),
      auditStatement(call.db, {
        opId: `credential.revoke:${credentialId}`,
        at: call.now,
        actorId: principal.principalId,
        action: 'credential.revoke',
        targetKind: 'system',
        targetId: credentialId,
        detail: { kind: row.kind, provider: row.provider, fingerprint: row.fingerprint },
      }),
    ])
  try {
    await env.CREDENTIAL_BACKUPS.put(
      `revocations/${credentialId}.json`,
      JSON.stringify({
        credentialId,
        revokedAt: row.revokedAt ?? call.now,
      }),
    )
  } catch {
    throw new Error('credential_revocation_incomplete: retry to persist revocation record')
  }
  await call.db
    .update(credentials)
    .set({ revocationRecordedAt: call.now })
    .where(eq(credentials.credentialId, credentialId))
  return { credentialId, status: 'revoked' as const, affectedAgents: coverage.agents }
}
