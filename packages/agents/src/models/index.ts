import { builtinModels } from '@earendil-works/pi-ai/providers/all'
import type { Models } from '@earendil-works/pi-ai/models'
import type { AgentEnv } from '../env.ts'

/** Worker secrets passed to model providers; add a provider's key here and in the Worker config. */
export const PROVIDER_SECRET_NAMES = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'XAI_API_KEY',
] as const satisfies readonly (keyof AgentEnv)[]

export type ModelProviderEnv = Partial<Pick<AgentEnv, (typeof PROVIDER_SECRET_NAMES)[number]>>

/** Resolve credentials from Worker secrets, never persisted agent settings. */
export function resolveProviderCredentials(env: ModelProviderEnv): Map<string, string> {
  const credentials = new Map<string, string>()
  for (const name of PROVIDER_SECRET_NAMES) {
    const value = env[name]
    if (value) credentials.set(name, value)
  }
  return credentials
}

export function createAgentModels(env: ModelProviderEnv): Models {
  const credentials = resolveProviderCredentials(env)
  return builtinModels({
    authContext: {
      env: async (name) => credentials.get(name),
      fileExists: async () => false,
    },
  })
}
