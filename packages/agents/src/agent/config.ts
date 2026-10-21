/** An agent's configuration: what Pi keeps, plus the shared spaces stored beside it. */
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { configure, ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import type { Harness } from '@earendil-works/pi-durable'
import type { Models } from '@earendil-works/pi-ai/models'
import { agentChange, agentConfigSchema, readAgentConfig } from '../configuration/index.ts'
import { readSharedSpaces, writeSharedSpaces } from '../configuration/shared-spaces.ts'
import type { AgentConfig } from '../protocol.ts'
import { parseInput } from '../validation.ts'

const context = BACKGROUND_CONTEXT

export interface ConfigStore {
  harness: Harness
  storage: DurableObjectStorage
  defaults: AgentConfig
}

export async function readConfig(store: ConfigStore): Promise<AgentConfig> {
  const spaces = await readSharedSpaces(store.storage, store.defaults.sharedSpaces)
  return readAgentConfig(store.harness, spaces)
}

/**
 * Validate and store a complete configuration while no task runs; history and request receipts
 * are kept. Returns the stored configuration.
 */
export async function replaceConfig(
  store: ConfigStore,
  models: Models,
  value: AgentConfig,
): Promise<AgentConfig> {
  const config = parseInput(agentConfigSchema(models), value)
  const { tasks } = await store.harness.inspect(context)
  if (tasks.length > 0) throw new Error('Agent is busy; retry configuration after it becomes idle')
  await store.harness.commit(
    (tx) => configure(tx, ROOT_CONVERSATION_ID, agentChange(config)),
    context,
  )
  await writeSharedSpaces(store.storage, config.sharedSpaces)
  return config
}
