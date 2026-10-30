/** Node-only credential intake; never imported by the Worker or persisted to auth.json. @module */
import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import type { AuthInteraction } from '@earendil-works/pi-ai'
import { createAgentModels } from '../control-plane/models.ts'

/** Prepare write-only API-key registration without embedding key values in failures. */
export function apiKeyRegistration(provider: string, requestId: string, input: string): string {
  const secret = input.trim()
  if (!secret) throw new Error('No API key supplied; use stdin or --key-from-env ENV_NAME')
  return JSON.stringify({ provider, requestId, kind: 'api_key', secret })
}

/** Classify only fixed SDK messages and allowlisted OAuth errors, never their secret-bearing text. */
function failureCategory(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown'
  const known: Record<string, string> = {
    'Paste the full callback URL from the browser': 'invalid_url',
    'The pasted callback URL must start with http://127.0.0.1:1455/auth/callback': 'wrong_redirect',
    'Missing authorization code': 'missing_code',
    'Missing OAuth state': 'missing_state',
    'OAuth state mismatch': 'state_mismatch',
    'OpenAI OAuth registration callback did not contain an issued client ID': 'missing_client_id',
    'Login cancelled': 'cancelled',
    'fetch failed': 'network',
  }
  if (Object.hasOwn(known, error.message)) return known[error.message] ?? 'unknown'
  const http = /^OpenAI OAuth token request failed \((\d{3})\): (.*)$/s.exec(error.message)
  if (http) {
    let code = 'unclassified'
    try {
      const body: unknown = JSON.parse(http[2] ?? '')
      if (typeof body === 'object' && body !== null && 'error' in body) {
        const candidate =
          typeof body.error === 'string'
            ? body.error
            : typeof body.error === 'object' && body.error !== null && 'code' in body.error
              ? body.error.code
              : undefined
        if (
          typeof candidate === 'string' &&
          [
            'invalid_grant',
            'invalid_client',
            'invalid_request',
            'access_denied',
            'server_error',
            'temporarily_unavailable',
          ].includes(candidate)
        )
          code = candidate
      }
    } catch {
      /* Provider bodies are untrusted and must not be echoed. */
    }
    return `http_${http[1]}_${code}`
  }
  if (error.message.startsWith('ChatGPT authorization failed:')) return 'authorization_rejected'
  if (
    error.message.startsWith('OpenAI OAuth token response') ||
    error.message.startsWith('OpenAI OAuth grant did not include')
  )
    return 'invalid_token_response'
  return 'unknown'
}

/** Run Pi's ChatGPT flow with an ephemeral store; return only a write-only registration body. */
export async function loginRegistration(
  installId: string,
  requestId: string,
  interaction: AuthInteraction,
): Promise<string> {
  const store = new InMemoryCredentialStore()
  let stage = 'setup'
  try {
    const models = createAgentModels(store)
    const credential = await models.login(
      'openai',
      'oauth',
      {
        ...interaction,
        notify(event) {
          if (event.type === 'auth_url') stage = 'redirect_validation'
          if (
            event.type === 'progress' &&
            event.message === 'Exchanging authorization code for tokens...'
          )
            stage = 'token_exchange'
          interaction.notify(event)
        },
      },
      {
        getDeviceId: () => installId,
        agentName: 'kodama',
      },
    )
    stage = 'credential_validation'
    if (
      credential.type !== 'oauth' ||
      !credential.clientId ||
      !Array.isArray(credential.scopes) ||
      !credential.scopes.includes('chatgpt.tokens.use.direct')
    )
      throw new Error('Invalid subscription credential')
    return JSON.stringify({
      provider: 'openai',
      requestId,
      kind: 'oauth_subscription',
      secret: JSON.stringify(credential),
    })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Port 1455 is in use'))
      throw new Error(
        'Port 1455 is in use. Cancel the other login or stop the process using it, then retry.',
      )
    throw new Error(
      `ChatGPT login failed [stage=${stage}; category=${interaction.signal?.aborted ? 'cancelled' : failureCategory(error)}]. Start a fresh login.`,
    )
  } finally {
    await store.delete('openai')
  }
}
