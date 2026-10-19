import { builtinModels } from '@earendil-works/pi-ai/providers/all'
import type { AgentEnv } from '../env.ts'

export type ModelProviderEnv = Partial<
  Pick<AgentEnv, 'OPENAI_API_KEY' | 'ANTHROPIC_API_KEY' | 'GEMINI_API_KEY' | 'XAI_API_KEY'>
>

/** Resolve credentials from Worker secrets, never persisted agent settings. */
export function resolveProviderCredentials(env: ModelProviderEnv): Map<string, string> {
  const credentials = new Map<string, string>()
  for (const name of [
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'GEMINI_API_KEY',
    'XAI_API_KEY',
  ] as const) {
    const value = env[name]
    if (value) credentials.set(name, value)
  }
  return credentials
}

export function createAgentModels(env: ModelProviderEnv) {
  const credentials = resolveProviderCredentials(env)
  return builtinModels({
    authContext: {
      env: async (name) => credentials.get(name),
      fileExists: async () => false,
    },
  })
}
