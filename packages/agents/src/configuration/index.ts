/**
 * Per-agent configuration: the settings of a version, their defaults and validation, and where an
 * object keeps the applied parts. Pi keeps the model, prompt, thinking level, and tools; the shared
 * spaces sit beside them in Durable Object storage.
 *
 * @see docs/agents.md — Configuration
 *
 * @module
 */
import * as v from 'valibot'
import { redactData } from '../lib/redaction.ts'
import { AgentDoc, configure, ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import type { Harness, AgentChange } from '@earendil-works/pi-durable'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import type { Models } from '@earendil-works/pi-ai/models'
import type { AgentEnv } from '../env.ts'
import type { AgentConfig, AgentSettings, MemoryPolicy } from '../protocol.ts'
import { UUID_PATTERN } from '../lib/uuid.ts'
import { agentTools, isRegisteredTool, resolveTools } from '../tools/index.ts'
import { parseInput } from '../validation.ts'

/** The variables that name the default model. */
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

/** The configuration of a new agent: the default model and prompt, no tools, the `global` space. */
export function defaultAgentConfig(env: DefaultModelEnv): AgentConfig {
  return {
    model: { provider: env.DEFAULT_MODEL_PROVIDER, modelId: env.DEFAULT_MODEL_ID },
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    thinkingLevel: 'off',
    tools: [],
    sharedSpaces: [...DEFAULT_SHARED_SPACES],
  }
}

/** The shared spaces an agent reads unless configured otherwise. */
export const DEFAULT_SHARED_SPACES: readonly string[] = ['global']
const MAX_SHARED_SPACES = 8
const spaceMessage =
  'sharedSpaces must be unique names of 1–64 lowercase letters, digits, or hyphens'

/** At most eight unique space names; stored next to the agent configuration. */
export const sharedSpacesSchema = v.pipe(
  v.array(v.pipe(v.string(spaceMessage), v.regex(/^[a-z0-9-]{1,64}$/, spaceMessage)), spaceMessage),
  v.maxLength(MAX_SHARED_SPACES, `sharedSpaces has at most ${MAX_SHARED_SPACES} spaces`),
  v.check((spaces) => new Set(spaces).size === spaces.length, spaceMessage),
)

const modelMessage = 'Expected a model with a provider and modelId'
const settingsMessage = 'Expected agent settings with schemaVersion 1'
const PROVIDER_ID = /^[a-z0-9][a-z0-9:._-]{0,63}$/
const TOOL_NAME = /^[a-z0-9_]{1,64}$/
const LABEL = /^[a-z0-9-]{1,32}$/
const MAX_LABELS = 16
const DESCRIPTION_MAX_LENGTH = 1_000

/** Every field of one configuration version, validated strictly; unknown fields are rejected. */
export function agentSettingsSchema(models: Models) {
  const credentialId = v.pipe(v.string(), v.regex(UUID_PATTERN, 'Credential IDs must be UUIDs'))
  const providerKey = v.pipe(v.string(), v.regex(PROVIDER_ID, 'Invalid provider ID'))
  const positive = (name: string) =>
    v.pipe(v.number(`${name} must be a positive number`), v.gtValue(0, `${name} must be positive`))
  return v.strictObject(
    {
      schemaVersion: v.literal(SETTINGS_SCHEMA_VERSION, 'schemaVersion must be 1'),
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
      sharedSpaces: sharedSpacesSchema,
      description: v.optional(
        v.pipe(
          v.string(),
          v.maxLength(
            DESCRIPTION_MAX_LENGTH,
            `description has at most ${DESCRIPTION_MAX_LENGTH} characters`,
          ),
        ),
      ),
      labels: v.optional(
        v.pipe(
          v.array(
            v.pipe(
              v.string(),
              v.regex(LABEL, 'Labels are 1–32 lowercase letters, digits, or hyphens'),
            ),
          ),
          v.maxLength(MAX_LABELS, `labels has at most ${MAX_LABELS} labels`),
          v.check((labels) => new Set(labels).size === labels.length, 'labels must be unique'),
        ),
      ),
      memoryPolicy: v.strictObject(
        { extract: v.boolean(), remember: v.boolean() },
        'memoryPolicy must have extract and remember',
      ),
      budget: v.optional(
        v.strictObject(
          {
            dailyUsd: v.optional(positive('budget.dailyUsd')),
            monthlyUsd: v.optional(positive('budget.monthlyUsd')),
            turnTokens: v.optional(
              v.pipe(
                positive('budget.turnTokens'),
                v.integer('budget.turnTokens must be an integer'),
              ),
            ),
            onExceed: v.picklist(
              ['refuse', 'downgrade'],
              'budget.onExceed must be refuse or downgrade',
            ),
          },
          'budget must have onExceed',
        ),
      ),
      credentials: v.optional(
        v.strictObject(
          { primary: v.record(providerKey, credentialId) },
          'credentials must contain only primary references',
        ),
      ),
      toolPolicy: v.optional(
        v.record(
          v.pipe(v.string(), v.regex(TOOL_NAME, 'toolPolicy keys must be tool names')),
          v.picklist(['allow', 'deny'], 'toolPolicy values must be allow or deny'),
        ),
      ),
    },
    settingsMessage,
  ) satisfies v.GenericSchema<unknown, AgentSettings>
}

/** The only shape of `AgentSettings` so far. */
export const SETTINGS_SCHEMA_VERSION = 1

/** A new agent extracts and offers `remember`. */
export const DEFAULT_MEMORY_POLICY: MemoryPolicy = { extract: true, remember: true }

/** Version 1 of an agent created without settings: {@link defaultAgentConfig} and the defaults. */
export function defaultAgentSettings(env: DefaultModelEnv): AgentSettings {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    ...defaultAgentConfig(env),
    memoryPolicy: { ...DEFAULT_MEMORY_POLICY },
  }
}

/**
 * Validate settings from a caller or from storage.
 *
 * @throws {@link TypeError} When `value` is not valid settings for `models`.
 */
export function parseSettings(models: Models, value: unknown): AgentSettings {
  return redactData(parseInput(agentSettingsSchema(models), value))
}

/**
 * Stored as the registered tools that are not selected, so tools of other extensions, such as
 * long-term memory, stay enabled.
 */
function toolChange(selected: readonly string[]): AgentChange['tools'] {
  resolveTools(selected)
  return { remove: agentTools.filter((tool) => !selected.includes(tool.name)) }
}

/**
 * The change that stores `config` in Pi.
 *
 * @throws {@link TypeError} When a tool is not registered.
 */
export function agentChange(config: AgentConfig): AgentChange {
  return {
    model: config.model,
    instructions: config.systemPrompt,
    thinkingLevel: config.thinkingLevel,
    tools: toolChange(config.tools),
  }
}

/** Selected registered tools, in registry order, from either stored form. */
function selectedTools(stored: string[] | { remove: string[] }): string[] {
  const names = agentTools.map((tool) => tool.name)
  if (Array.isArray(stored)) return names.filter((name) => stored.includes(name))
  return names.filter((name) => !stored.remove.includes(name))
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
    // Agents stored before long-term memory list their tools; keep memory tools enabled.
    if (Array.isArray(state.tools)) {
      await configure(tx, ROOT_CONVERSATION_ID, { tools: toolChange(selectedTools(state.tools)) })
    }
  }, BACKGROUND_CONTEXT)
}

/**
 * The configuration Pi stores, with the shared spaces stored beside it.
 *
 * @throws {@link Error} When Pi has no model, prompt, or thinking level yet.
 */
export async function readAgentConfig(
  harness: Harness,
  sharedSpaces: readonly string[],
): Promise<AgentConfig> {
  const state = await harness.snapshot(AgentDoc, ROOT_CONVERSATION_ID, BACKGROUND_CONTEXT)
  if (!state?.model || state.instructions === undefined || !state.thinkingLevel) {
    throw new Error('Agent configuration is incomplete')
  }
  return {
    model: { ...state.model },
    systemPrompt: state.instructions,
    thinkingLevel: state.thinkingLevel,
    // The memory agent stores no tool selection: its registry holds only its own tools.
    tools: state.tools ? selectedTools(state.tools) : [],
    sharedSpaces: [...sharedSpaces],
  }
}

/** The Durable Object storage key of an agent's shared spaces. */
export const SHARED_SPACES_KEY = 'kodama:shared-spaces'

/** The stored shared spaces, or `defaults` when none are stored or they are invalid. */
export async function readSharedSpaces(
  storage: DurableObjectStorage,
  defaults: readonly string[],
): Promise<string[]> {
  const stored = v.safeParse(sharedSpacesSchema, await storage.get(SHARED_SPACES_KEY))
  return stored.success ? stored.output : [...defaults]
}

/** The prompt of an agent nobody configured. */
export const DEFAULT_SYSTEM_PROMPT = 'You are Kodama, a helpful and concise assistant.'

/** Where an agent's configuration lives, and the defaults for what is missing. */
export interface ConfigStore {
  harness: Harness
  storage: DurableObjectStorage
  defaults: AgentConfig
}

/** The agent's whole configuration. */
export async function readConfig(store: ConfigStore): Promise<AgentConfig> {
  const spaces = await readSharedSpaces(store.storage, store.defaults.sharedSpaces)
  return readAgentConfig(store.harness, spaces)
}
