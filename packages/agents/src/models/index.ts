/**
 * Pi's model providers, with credentials from the Worker's secrets.
 *
 * @module
 */
import { builtinModels } from '@earendil-works/pi-ai/providers/all'
import type { Models } from '@earendil-works/pi-ai/models'
import type { AgentEnv } from '../env.ts'

/**
 * Worker secrets passed to model providers.
 *
 * @remarks
 * To support another provider, add its key here and as a secret binding in `cloudflare.config.ts`.
 */
export const PROVIDER_SECRET_NAMES = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'XAI_API_KEY',
] as const satisfies readonly (keyof AgentEnv)[]

/** The provider secrets a model catalog needs; each may be missing. */
export type ModelProviderEnv = Partial<Pick<AgentEnv, (typeof PROVIDER_SECRET_NAMES)[number]>>

/**
 * Provider credentials from Worker secrets, never from stored agent settings; empty ones are left out.
 */
export function resolveProviderCredentials(env: ModelProviderEnv): Map<string, string> {
  const credentials = new Map<string, string>()
  for (const name of PROVIDER_SECRET_NAMES) {
    const value = env[name]
    if (value) credentials.set(name, value)
  }
  return credentials
}

/** Pi's built-in providers and model catalogs, authenticated from Worker secrets only. */
export function createAgentModels(env: ModelProviderEnv): Models {
  const credentials = resolveProviderCredentials(env)
  return builtinModels({
    authContext: {
      env: async (name) => credentials.get(name),
      fileExists: async () => false,
    },
  })
}
