/**
 * A working agent's model and tool registration, built on the shared harness settings.
 *
 * @see docs/agents.md — Harness
 *
 * @module
 */
import type { CredentialStore } from '@earendil-works/pi-ai'
import { configure, createRegistry, defineExtension } from '@earendil-works/pi-durable'
import type { Extension, HarnessOptions } from '@earendil-works/pi-durable'
import { agentChange, defaultAgentConfig } from '../configuration/index.ts'
import type { DefaultModelEnv } from '../configuration/index.ts'
import { createAgentModels } from '../models/index.ts'
import { createAgentTools } from '../tools/index.ts'
import type { ContactAgent } from '../tools/contact-agent.ts'
import { harnessSettings } from '../runtime/harness.ts'
import { guardedModels } from '../runtime/restrictions.ts'
import type { Refusal } from '../runtime/restrictions.ts'

/**
 * Register the working agent's optional tools alongside its always-enabled extensions.
 *
 * @param always - Extensions such as memory and restriction checks, independent of tool selection.
 * @param refusal - Checked before every model request.
 */
export function createAgentOptions(
  env: DefaultModelEnv,
  always: readonly Extension[] = [],
  refusal: Refusal = () => undefined,
  credentials?: CredentialStore,
  contact?: ContactAgent,
): HarnessOptions {
  const extension = defineExtension({ name: 'kodama', tools: createAgentTools(contact) })
  const registry = createRegistry()
  registry.install(extension)
  for (const extra of always) registry.install(extra)
  return {
    models: guardedModels(createAgentModels(credentials), refusal),
    registry,
    settings: harnessSettings([extension, ...always]),
    conversationCreated: (tx, conversation) =>
      conversation.owner === undefined && conversation.parent === undefined
        ? configure(tx, conversation.id, agentChange(defaultAgentConfig(env)))
        : undefined,
  }
}
