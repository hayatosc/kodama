/** Node-only credential intake; never imported by the Worker or persisted to auth.json. @module */
import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import type { AuthInteraction } from '@earendil-works/pi-ai'
import { createAgentModels } from '../models/index.ts'

/** Prepare write-only API-key registration without embedding key values in failures. */
export function apiKeyRegistration(provider: string, requestId: string, input: string): string {
  const secret = input.trim()
  if (!secret) throw new Error('No API key supplied; use stdin or --key-from-env ENV_NAME')
  return JSON.stringify({ provider, requestId, kind: 'api_key', secret })
}

/** Run Pi's ChatGPT flow with an ephemeral store; return only a write-only registration body. */
export async function loginRegistration(
  installId: string,
  requestId: string,
  interaction: AuthInteraction,
): Promise<string> {
  const store = new InMemoryCredentialStore()
  try {
    const models = createAgentModels(store)
    const credential = await models.login('openai', 'oauth', interaction, {
      getDeviceId: () => installId,
      agentName: 'kodama',
    })
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
    throw new Error('ChatGPT login failed; retry with the full redirect URL from the browser.')
  } finally {
    await store.delete('openai')
  }
}
