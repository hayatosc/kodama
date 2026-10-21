/** The memory agent's harness: its own tools, model, and instructions (Memory agent). */
import { configure, createRegistry, defineExtension } from '@earendil-works/pi-durable'
import type { HarnessOptions } from '@earendil-works/pi-durable'
import type { AgentEnv } from '../../env.ts'
import { harnessSettings } from '../../agent/harness.ts'
import { createAgentModels } from '../../models/index.ts'
import type { AgentConfig } from '../../protocol.ts'
import { MEMORY_SYSTEM_PROMPT } from './prompts.ts'
import { createMemoryAgentTools } from './tools/index.ts'
import type { RunningJob } from './tools/common.ts'

/** The memory agent's model: `MEMORY_MODEL_*`, or the default model when they are empty. */
export function memoryModel(env: AgentEnv): { provider: string; modelId: string } {
  return {
    provider: env.MEMORY_MODEL_PROVIDER || env.DEFAULT_MODEL_PROVIDER,
    modelId: env.MEMORY_MODEL_ID || env.DEFAULT_MODEL_ID,
  }
}

export function memoryAgentConfig(env: AgentEnv): AgentConfig {
  return {
    model: memoryModel(env),
    systemPrompt: MEMORY_SYSTEM_PROMPT,
    thinkingLevel: 'off',
    tools: [],
    sharedSpaces: [],
  }
}

export function memoryHarnessOptions(
  env: AgentEnv,
  runningJob: () => Promise<RunningJob | undefined>,
): HarnessOptions {
  const extension = defineExtension({
    name: 'kodama-memory-agent',
    tools: createMemoryAgentTools({ env, runningJob }),
  })
  const registry = createRegistry()
  registry.install(extension)
  const model = memoryModel(env)
  return {
    models: createAgentModels(env),
    registry,
    settings: harnessSettings([extension]),
    conversationCreated: (tx, conversation) =>
      conversation.owner === undefined && conversation.parent === undefined
        ? configure(tx, conversation.id, {
            model,
            instructions: MEMORY_SYSTEM_PROMPT,
            thinkingLevel: 'off',
          })
        : undefined,
  }
}
