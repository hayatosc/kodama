/** Agent-local credential resolution through the live management database. @module */
import type { AgentEnv } from '../env.ts'
import type { AgentSettings } from '../protocol.ts'
import { managementDb } from '../control-plane/db.ts'
import { agentRowByObjectName } from '../control-plane/registry.ts'
import { createCredentialStore } from './store.ts'

/** Working and dedicated agents resolve the registry ID through the same store. */
export function agentCredentialStore(
  env: AgentEnv,
  objectName: () => string,
  settings: () => Promise<AgentSettings | undefined>,
) {
  const db = managementDb(env.MANAGEMENT_DB)
  return createCredentialStore(
    db,
    async () => {
      const row = await agentRowByObjectName(db, objectName())
      if (!row) throw new Error('credential_unavailable: agent is not registered')
      return row.agentId
    },
    settings,
    () => env.CREDENTIAL_KEK_V1,
  )
}
