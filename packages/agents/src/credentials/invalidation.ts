/** Best-effort DO invalidation after a committed credential restriction. @module */
import type { ManagementCall } from '../control-plane/workflows/agents.ts'
import selectCredentialRefObjects from './sql/select-credential-ref-objects.sql'

/** Await each notification before acknowledging revocation; live store checks also protect failed pushes. */
export async function invalidateCredential(call: ManagementCall, credentialId: string) {
  const rows = await selectCredentialRefObjects.run(call.db, { credentialId })
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
