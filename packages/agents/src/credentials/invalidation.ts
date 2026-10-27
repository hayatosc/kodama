/** Best-effort DO invalidation after a committed credential restriction. @module */
import { eq } from 'drizzle-orm'
import { agentCredentialRefs, agents } from '../../drizzle/management/schema.ts'
import type { ManagementCall } from '../management/service/agents.ts'

/** Await each notification before acknowledging revocation; live store checks also protect failed pushes. */
export async function invalidateCredential(call: ManagementCall, credentialId: string) {
  const rows = await call.db
    .select({ objectName: agents.objectName })
    .from(agentCredentialRefs)
    .innerJoin(agents, eq(agents.agentId, agentCredentialRefs.agentId))
    .where(eq(agentCredentialRefs.credentialId, credentialId))
  return Promise.all(
    rows.map(async ({ objectName }) => {
      try {
        await call.env.AGENTS.getByName(objectName).invalidateCredentials()
        return true
      } catch {
        return false
      }
    }),
  )
}
