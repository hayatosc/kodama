import { AgentDoc, configure, ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import type { Harness, AgentChange } from '@earendil-works/pi-durable'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import * as v from 'valibot'
import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import type { Models } from '@earendil-works/pi-ai/models'
import type { AgentEnv } from '../env.ts'
import type { AgentConfig } from '../protocol.ts'
import { DEFAULT_SYSTEM_PROMPT } from '../prompts/default.ts'
import { isRegisteredTool, resolveTools } from '../tools/index.ts'

export type DefaultModelEnv = Pick<AgentEnv, 'DEFAULT_MODEL_PROVIDER' | 'DEFAULT_MODEL_ID'>

const THINKING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly ModelThinkingLevel[]
const SYSTEM_PROMPT_MAX_LENGTH = 64_000

export function defaultAgentConfig(env: DefaultModelEnv): AgentConfig {
  return {
    model: { provider: env.DEFAULT_MODEL_PROVIDER, modelId: env.DEFAULT_MODEL_ID },
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    thinkingLevel: 'off',
    tools: [],
  }
}

/** Complete configuration accepted over RPC; unknown fields are rejected rather than ignored. */
export function agentConfigSchema(models: Models) {
  const modelMessage = 'Expected an agent configuration with a provider and modelId'
  return v.strictObject(
    {
      model: v.pipe(
        v.strictObject({ provider: v.string(), modelId: v.string() }, modelMessage),
        v.check(
          ({ provider, modelId }) => models.getModel(provider, modelId) !== undefined,
          (issue) => `Unknown model: ${issue.input.provider}/${issue.input.modelId}`,
        ),
      ),
      systemPrompt: v.pipe(
        v.string(),
        v.maxLength(
          SYSTEM_PROMPT_MAX_LENGTH,
          `systemPrompt must be a string of at most ${SYSTEM_PROMPT_MAX_LENGTH} characters`,
        ),
      ),
      thinkingLevel: v.picklist(THINKING_LEVELS, 'Invalid thinkingLevel'),
      tools: v.pipe(
        v.array(v.string(), 'tools must be an array'),
        v.check(
          (tools) => new Set(tools).size === tools.length,
          'tools must contain unique tool names',
        ),
        v.check(
          (tools) => tools.every(isRegisteredTool),
          (issue) => `Unknown tool: ${issue.input.find((name) => !isRegisteredTool(name))}`,
        ),
      ),
    },
    modelMessage,
  ) satisfies v.GenericSchema<unknown, AgentConfig>
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
