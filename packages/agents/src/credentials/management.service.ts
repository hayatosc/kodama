/**
 * Credential management service with the same caller rules as other management RPC. RPC inputs and
 * results never expose stored envelopes. Revocation commits its state and audit together in D1.
 *
 * @module
 */
import * as v from 'valibot'
import {
  auditByOpId,
  auditIgnoreStatement,
  auditStatement,
} from '../control-plane/audit.service.ts'
import { installationId } from '../control-plane/installation.service.ts'
import { findAgentById } from '../control-plane/registry.repository.ts'
import type { ManagementCall } from '../control-plane/workflows/agents.service.ts'
import type { AgentEnv } from '../env.ts'
import { isConstraintError } from '../lib/errors.ts'
import { runBatch } from '../lib/reylo.ts'
import { UUID_PATTERN, uuidv7 } from '../lib/uuid.ts'
import { parseAgentId, RequestIdSchema } from '../validation.ts'
import { credentialFingerprint } from './encryption.ts'
import {
  findCredentialGrant,
  insertCredentialGrantStatement,
  listCredentialGrantsByCredential,
  listCredentialReferences,
} from './grants.repository.ts'
import { invalidateCredential } from './invalidation.service.ts'
import {
  findCredentialById,
  listProviderCredentials,
  revokeCredentialStatement,
} from './vault.repository.ts'
import { credentialInsert, credentialMetadata } from './vault.service.ts'

/** Keep storage diagnostics (which can contain ciphertext bindings) out of RPC exceptions. */
export async function credentialRpc<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof TypeError) throw new TypeError('Invalid credential operation')
    if (error instanceof Error && /^(forbidden:|credential_)/.test(error.message))
      throw new Error(error.message)
    throw new Error('credential_unavailable: operation failed')
  }
}

const putSchema = v.strictObject({
  kind: v.optional(v.picklist(['api_key', 'oauth_subscription']), 'api_key'),
  requestId: RequestIdSchema,
  provider: v.pipe(v.string(), v.regex(/^[a-z][a-z0-9-]{0,63}$/)),
  secret: v.pipe(v.string(), v.minLength(8), v.maxLength(16384)),
})

/** Register either credential kind atomically with its audit row; secret parsing errors contain no values. */
export async function putCredential(
  call: ManagementCall,
  env: Pick<AgentEnv, 'CREDENTIAL_KEK_V1'>,
  request: unknown,
) {
  const parsed = v.safeParse(putSchema, request)
  if (!parsed.success) throw new TypeError('Invalid credential registration')
  const input = parsed.output
  const fingerprint = await credentialFingerprint(input.secret, env.CREDENTIAL_KEK_V1)
  const opId = `credential.put:${input.requestId}`
  async function replay() {
    const previous = await auditByOpId(call.db, opId)
    if (!previous) return undefined
    const row = await credentialRow(call, previous.targetId)
    if (
      row.kind !== input.kind ||
      row.provider !== input.provider ||
      row.fingerprint !== fingerprint
    )
      throw new Error('credential_conflict')
    return credentialMetadata(row)
  }
  const previous = await replay()
  if (previous) return previous
  const credentialId = uuidv7(call.now)
  const { statement } = await credentialInsert(
    call.db,
    {
      credentialId,
      kind: input.kind,
      provider: input.provider,
      revision: 1,
    },
    input.secret,
    env.CREDENTIAL_KEK_V1,
    call.now,
  )
  await installationId(call.db, call.now)
  // The prepared insert contains ciphertext only. The audit never includes an input object.
  try {
    await runBatch(call.db, [
      statement,
      auditStatement(call.db, {
        opId,
        at: call.now,
        source: call.source,
        action: 'credential.put',
        targetKind: 'system',
        targetId: credentialId,
        detail: {
          kind: input.kind,
          provider: input.provider,
          fingerprint,
        },
      }),
    ])
    const row = await findCredentialById(call.db, credentialId)
    if (!row) throw new Error('credential_unavailable: registration failed')
    return credentialMetadata(row)
  } catch (error) {
    if (isConstraintError(error)) {
      const previous = await replay()
      if (previous) return previous
    }
    throw error
  }
}

/** List metadata only; envelopes are never part of this result. */
export async function listCredentials(call: ManagementCall) {
  return (await listProviderCredentials(call.db)).map(credentialMetadata)
}

/** Read one credential after authorization, rejecting unknown IDs. */
export async function credentialRow(call: ManagementCall, id: string) {
  if (!UUID_PATTERN.test(id)) throw new TypeError('credentialId must be a lowercase UUID v7')
  const row = await findCredentialById(call.db, id)
  if (!row || row.purpose !== 'model_provider') throw new TypeError('Unknown credential')
  return row
}

/** Show the affected agents before a caller chooses to revoke a credential. */
export async function credentialCoverage(call: ManagementCall, credentialId: string) {
  const row = await credentialRow(call, credentialId)
  const references = await listCredentialReferences(call.db, credentialId)
  const grants = await listCredentialGrantsByCredential(call.db, credentialId)
  return {
    credential: credentialMetadata(row),
    references,
    agents: grants.map((grant) => grant.agentId),
  }
}

/** Grant permission without changing a version; assignment is a separate atomic operation. */
export async function grantCredential(call: ManagementCall, credentialId: string, agentId: string) {
  const row = await credentialRow(call, credentialId)
  const agent = await findAgentById(call.db, parseAgentId(agentId))
  if (!agent) throw new TypeError('Unknown agent')
  if (row.status !== 'active') throw new Error('credential_unavailable: inactive credential')
  const findGrant = () => findCredentialGrant(call.db, credentialId, agentId)
  if (!(await findGrant())) {
    try {
      await runBatch(call.db, [
        insertCredentialGrantStatement(call.db, credentialId, agentId),
        auditStatement(call.db, {
          opId: uuidv7(),
          at: call.now,
          source: call.source,
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
    } catch (error) {
      if (!isConstraintError(error) || !(await findGrant())) throw error
    }
  }
  return { credentialId, agentId }
}

/** Revoke and clear the envelope atomically with audit; repeated calls preserve the first revocation. */
export async function revokeCredential(call: ManagementCall, credentialId: string) {
  const row = await credentialRow(call, credentialId)
  const coverage = await credentialCoverage(call, credentialId)
  if (row.status !== 'revoked')
    await runBatch(call.db, [
      revokeCredentialStatement(call.db, credentialId, call.now),
      auditIgnoreStatement(call.db, {
        opId: `credential.revoke:${credentialId}`,
        at: call.now,
        source: call.source,
        action: 'credential.revoke',
        targetKind: 'system',
        targetId: credentialId,
        detail: { kind: row.kind, provider: row.provider, fingerprint: row.fingerprint },
      }),
    ])
  await invalidateCredential(call, credentialId)
  return { credentialId, status: 'revoked' as const, affectedAgents: coverage.agents }
}
