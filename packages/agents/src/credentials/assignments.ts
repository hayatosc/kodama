/** Credential assignments update grants, configuration versions, indexes, and audit atomically. @module */
import { and, eq } from 'drizzle-orm'
import { agents, credentialGrants } from '../../drizzle/management/schema.ts'
import type { ManagementCall } from '../management/service/agents.ts'
import { parseSettings } from '../configuration/index.ts'
import { versionRow, writeVersionStatements } from '../management/versions.ts'
import { auditStatement } from '../management/audit.ts'
import { parseAgentId } from '../validation.ts'
import { uuidv7 } from '../lib/uuid.ts'
import { credentialRow, credentialActor } from './management.ts'
import { referenceStatements } from './references.ts'

/** Assign or unassign one credential, for one agent or every current agent, as one D1 transaction. */
export async function assignCredential(
  call: ManagementCall,
  credentialId: string,
  target: string,
  remove = false,
) {
  const principal = credentialActor(call)
  const credential = await credentialRow(call, credentialId)
  if (!remove && credential.status !== 'active' && credential.status !== 'retiring')
    throw new Error('credential_unavailable: inactive credential')
  const targets = await call.db
    .select()
    .from(agents)
    .where(target === 'all' ? undefined : eq(agents.agentId, parseAgentId(target)))
  if (targets.length === 0 && target !== 'all') throw new TypeError('Unknown agent')
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
          actorId: principal.principalId,
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
  await call.db.batch([
    auditStatement(call.db, {
      opId: uuidv7(),
      at: call.now,
      actorId: principal.principalId,
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
      ...referenceStatements(call.db, agent.agentId, agent.currentVersion + 1, updated),
      ...(remove
        ? [
            call.db
              .delete(credentialGrants)
              .where(
                and(
                  eq(credentialGrants.credentialId, credentialId),
                  eq(credentialGrants.agentId, agent.agentId),
                ),
              ),
          ]
        : [
            call.db
              .insert(credentialGrants)
              .values({ credentialId, agentId: agent.agentId, createdAt: call.now })
              .onConflictDoNothing(),
          ]),
    ]),
  ])
  return {
    credentialId,
    agents: changes.map(({ agent }) => ({
      agentId: agent.agentId,
      version: agent.currentVersion + 1,
    })),
  }
}
