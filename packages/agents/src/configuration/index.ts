import { AgentDoc, configure, ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import type { Harness, AgentChange } from '@earendil-works/pi-durable'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Models } from '@earendil-works/pi-ai/models'
import type { AgentConfig } from '../protocol.ts'
import { DEFAULT_SYSTEM_PROMPT } from '../prompts/default.ts'
import { resolveTools } from '../tools/index.ts'

export function defaultAgentConfig(provider: string, modelId: string): AgentConfig {
  return {
    model: { provider, modelId },
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    thinkingLevel: 'off',
    tools: [],
  }
}

export function parseAgentConfig(value: unknown, models: Models): AgentConfig {
  if (
    typeof value !== 'object' ||
    value === null ||
    Object.keys(value).some(
      (key) => !['model', 'systemPrompt', 'thinkingLevel', 'tools'].includes(key),
    ) ||
    !('model' in value) ||
    typeof value.model !== 'object' ||
    value.model === null ||
    !('provider' in value.model) ||
    typeof value.model.provider !== 'string' ||
    !('modelId' in value.model) ||
    typeof value.model.modelId !== 'string' ||
    Object.keys(value.model).some((key) => !['provider', 'modelId'].includes(key))
  ) {
    throw new TypeError('Expected an agent configuration with a provider and modelId')
  }
  if (!models.getModel(value.model.provider, value.model.modelId)) {
    throw new TypeError(`Unknown model: ${value.model.provider}/${value.model.modelId}`)
  }
  if (
    !('systemPrompt' in value) ||
    typeof value.systemPrompt !== 'string' ||
    value.systemPrompt.length > 64_000
  ) {
    throw new TypeError('systemPrompt must be a string of at most 64000 characters')
  }
  if (
    !('thinkingLevel' in value) ||
    (value.thinkingLevel !== 'off' &&
      value.thinkingLevel !== 'minimal' &&
      value.thinkingLevel !== 'low' &&
      value.thinkingLevel !== 'medium' &&
      value.thinkingLevel !== 'high' &&
      value.thinkingLevel !== 'xhigh' &&
      value.thinkingLevel !== 'max')
  ) {
    throw new TypeError('Invalid thinkingLevel')
  }
  if (!('tools' in value) || !Array.isArray(value.tools))
    throw new TypeError('tools must be an array')
  const tools: string[] = []
  for (const name of value.tools) {
    if (typeof name !== 'string' || tools.includes(name))
      throw new TypeError('tools must contain unique tool names')
    tools.push(name)
  }
  resolveTools(tools)
  return {
    model: { provider: value.model.provider, modelId: value.model.modelId },
    systemPrompt: value.systemPrompt,
    thinkingLevel: value.thinkingLevel,
    tools,
  }
}

export function agentChange(config: AgentConfig): AgentChange {
  return {
    model: config.model,
    instructions: config.systemPrompt,
    thinkingLevel: config.thinkingLevel,
    tools: resolveTools(config.tools),
  }
}

/** Upgrade the original fixed-prompt agents without resetting their history or stored model. */
export async function initializeAgentConfig(
  harness: Harness,
  defaults: AgentConfig,
): Promise<void> {
  await harness.commit(async (tx) => {
    const state = await tx.doc(AgentDoc, ROOT_CONVERSATION_ID)
    if (state.instructions === undefined) {
      await configure(tx, ROOT_CONVERSATION_ID, { instructions: defaults.systemPrompt })
    }
  }, BACKGROUND_CONTEXT)
}

export async function readAgentConfig(harness: Harness): Promise<AgentConfig> {
  const state = await harness.snapshot(AgentDoc, ROOT_CONVERSATION_ID, BACKGROUND_CONTEXT)
  if (
    !state?.model ||
    state.instructions === undefined ||
    !state.thinkingLevel ||
    !Array.isArray(state.tools)
  ) {
    throw new Error('Agent configuration is incomplete')
  }
  return {
    model: { ...state.model },
    systemPrompt: state.instructions,
    thinkingLevel: state.thinkingLevel,
    tools: [...state.tools],
  }
}
