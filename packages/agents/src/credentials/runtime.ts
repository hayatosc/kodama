/** Agent-local credential resolution, isolated from model and tool configuration. @module */
import type { AgentEnv } from '../env.ts'
import type { AgentSettings } from '../protocol.ts'
import { managementDb } from '../management/db.ts'
import { agentRowByObjectName } from '../management/registry.ts'
import { createCredentialStore } from './store.ts'

/** Resolve the registry identity lazily so dedicated object names never become grant IDs. */
export function agentCredentialStore(
  env: AgentEnv,
  objectName: () => string,
  settings: () => Promise<AgentSettings | undefined>,
) {
  const db = managementDb(env.MANAGEMENT_DB)
  const handle = createCredentialStore(
    db,
    async () => {
      const row = await agentRowByObjectName(db, objectName())
      if (!row) throw new Error('credential_unavailable: agent is not registered')
      return row.agentId
    },
    settings,
    () => env.CREDENTIAL_KEK_V1,
  )
  const read = handle.store.read.bind(handle.store)
  handle.store.read = async (provider, options) => {
    const value = await read(provider, options)
    if (!value)
      throw new Error(`credential_unavailable: ${provider}: no usable assigned credential`)
    return value
  }
  return handle
}
