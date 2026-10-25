/** Agent-local credential resolution and exact-secret redaction. @module */
import type { AgentEnv } from '../env.ts'
import type { AgentSettings } from '../protocol.ts'
import { managementDb } from '../management/db.ts'
import { agentRowByObjectName } from '../management/registry.ts'
import { createSecretRedactor } from '../lib/redaction.ts'
import { createCredentialStore } from './store.ts'

/** Working and dedicated agents resolve the registry ID through the same store. */
export function agentCredentialStore(env: AgentEnv, objectName: () => string, settings: () => Promise<AgentSettings | undefined>) {
  const db = managementDb(env.MANAGEMENT_DB)
  const redactor = createSecretRedactor()
  const handle = createCredentialStore(db, async () => {
    const row = await agentRowByObjectName(db, objectName())
    if (!row) throw new Error('credential_unavailable: agent is not registered')
    return row.agentId
  }, settings, () => env.CREDENTIAL_KEK_V1, Date.now, redactor.remember)
  return { ...handle, redact: redactor.text }
}
