/** Credential assignments update grants, configuration versions, indexes, and audit atomically. @module */
import { auditStatement } from '../control-plane/audit.service.ts'
import { parseSettings } from '../control-plane/config.ts'
import { findAgentById } from '../control-plane/registry.repository.ts'
import { listAgentRows } from '../control-plane/registry.service.ts'
import { versionRow, writeVersionStatements } from '../control-plane/versions.service.ts'
import { pushDesired } from '../control-plane/workflows/agents.service.ts'
import type { ManagementCall } from '../control-plane/workflows/agents.service.ts'
import { runBatch } from '../lib/reylo.ts'
import { uuidv7 } from '../lib/uuid.ts'
import { parseAgentId } from '../validation.ts'
import {
  deleteCredentialGrantStatement,
  insertCredentialGrantIgnoreStatement,
  referenceStatements,
} from './grants.repository.ts'
import { credentialRow } from './management.service.ts'

/** Assign or unassign one credential, for one agent or every current agent, as one D1 transaction. */
export async function assignCredential(
  call: ManagementCall,
  credentialId: string,
  target: string,
  remove = false,
) {
  const credential = await credentialRow(call, credentialId)
  if (!remove && credential.status !== 'active')
    throw new Error('credential_unavailable: inactive credential')
  const targets =
    target === 'all'
      ? await listAgentRows(call.db, {})
      : await (async () => {
          const row = await findAgentById(call.db, parseAgentId(target))
          if (!row) throw new TypeError('Unknown agent')
          return [row]
        })()
  const changes = await Promise.all(
    targets.map(async (agent) => {
      const row = await versionRow(call.db, agent.agentId, agent.currentVersion)
      if (!row) throw new Error('Agent has no configuration')
      const settings = parseSettings(call.models, JSON.parse(row.settingsJson))
      const next = { primary: { ...settings.credentials?.primary } }
      if (remove) {
        if (next.primary[credential.provider] === credentialId)
          delete next.primary[credential.provider]
      } else next.primary[credential.provider] = credentialId
      const updated = { ...settings, credentials: next }
      const statements = writeVersionStatements(
        call.db,
        {
          source: call.source,
          now: call.now,
          opId: uuidv7(),
        },
        agent.agentId,
        agent.currentVersion,
        updated,
        { comment: remove ? 'Credential unassigned' : 'Credential assigned' },
      )
      return { agent, updated, statements }
    }),
  )
  await runBatch(call.db, [
    auditStatement(call.db, {
      opId: uuidv7(),
      at: call.now,
      source: call.source,
      action: remove ? 'credential.unassign' : 'credential.assign',
      targetKind: 'system',
      targetId: credentialId,
      detail: {
        kind: credential.kind,
        provider: credential.provider,
        fingerprint: credential.fingerprint,
        agents: targets.map((row) => row.agentId),
      },
    }),
    ...changes.flatMap(({ agent, updated, statements }) => [
      ...statements,
      ...referenceStatements(call.db, agent.agentId, updated),
      remove
        ? deleteCredentialGrantStatement(call.db, credentialId, agent.agentId)
        : insertCredentialGrantIgnoreStatement(call.db, credentialId, agent.agentId),
    ]),
  ])
  await Promise.all(
    changes.map(async ({ agent }) => {
      try {
        await call.env.AGENTS.getByName(agent.objectName).invalidateCredentials()
      } catch {
        console.error(`Invalidating credentials of agent ${agent.agentId} failed`)
      }
      try {
        await pushDesired(call, agent.agentId)
      } catch {
        // Reconciliation retries committed versions; never log credential-bearing errors.
        console.error(`Pushing desired version to agent ${agent.agentId} failed`)
      }
    }),
  )
  return {
    credentialId,
    agents: changes.map(({ agent }) => ({
      agentId: agent.agentId,
      version: agent.currentVersion + 1,
    })),
  }
}
