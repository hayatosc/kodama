/** Native routing uses provider/API and official base, never model-name heuristics. @module */

/** The applied conversation model; its ID passes through unchanged. */
export interface SearchModel {
  provider: string
  api: string
  id: string
  baseUrl: string
}

const routes = [
  {
    provider: 'openai',
    api: 'openai-responses',
    base: 'https://api.openai.com/v1',
    endpoint: 'https://api.openai.com/v1/responses',
    dialect: 'responses',
  },
  {
    provider: 'xai',
    api: 'openai-responses',
    base: 'https://api.x.ai/v1',
    endpoint: 'https://api.x.ai/v1/responses',
    dialect: 'responses',
  },
  {
    provider: 'anthropic',
    api: 'anthropic-messages',
    base: 'https://api.anthropic.com',
    endpoint: 'https://api.anthropic.com/v1/messages',
    dialect: 'anthropic-messages',
  },
  {
    provider: 'deepseek',
    api: 'openai-completions',
    base: 'https://api.deepseek.com',
    endpoint: 'https://api.deepseek.com/anthropic/v1/messages',
    dialect: 'deepseek-messages',
  },
  {
    provider: 'google',
    api: 'google-generative-ai',
    base: 'https://generativelanguage.googleapis.com/v1beta',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta',
    dialect: 'google',
  },
] as const

/** A fixed native destination, with explicit DeepSeek transport translation. */
export type NativeRoute = (typeof routes)[number]

/** Choose keyless before any send; a native failure must never call this again to reroute. */
export function searchRoute(
  model: SearchModel,
  mode: 'auto' | 'keyless' = 'auto',
): NativeRoute | undefined {
  if (mode === 'keyless') return undefined
  return routes.find(
    (route) =>
      route.provider === model.provider && route.api === model.api && route.base === model.baseUrl,
  )
}

/** Reject incompatible credentials without switching authentication or billing routes. */
export function requireSearchCredential(route: NativeRoute, kind: string): void {
  if (kind === 'api_key' || (route.provider === 'openai' && kind === 'oauth_subscription')) return
  throw new Error('unsupported_credential_kind')
}
