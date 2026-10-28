/**
 * ChatGPT refresh grant: RFC 6749 §§5.1, 5.2, 6 and Pi's resource-scoped public-client request.
 * Provider error details never escape this boundary.
 * @see docs/credentials.md — OAuth refresh contract
 * @module
 */
import type { OAuthCredential } from '@earendil-works/pi-ai'
import * as v from 'valibot'

const tokenString = v.pipe(
  v.string(),
  v.check((value) => value.trim().length > 0),
)
const tokenSchema = v.object({
  access_token: tokenString,
  token_type: v.pipe(
    v.string(),
    v.check((value) => value.toLowerCase() === 'bearer'),
  ),
  refresh_token: v.optional(tokenString),
  expires_in: v.pipe(
    v.number(),
    v.finite(),
    v.check((value) => value > 0),
  ),
  scope: v.optional(v.string()),
})
const rejectionSchema = v.object({
  error: v.union([v.string(), v.object({ code: v.string() })]),
})
const permanentErrors = new Set([
  // RFC 6749 §5.2: retrying the same client/request/grant cannot repair these failures.
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'unauthorized_client',
  'unsupported_grant_type',
  'invalid_scope',
  // OpenAI Errors and recovery — Refresh errors.
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_reused',
  'refresh_token_expired',
  'refresh_token_invalidated',
])

/** Internal failure marker: the lease owner must persist needs_reauth before surfacing the state. */
export const REFRESH_REJECTED = 'credential_refresh_rejected'

/** Keep refresh inside the vault lease, including Pi's five-minute preemptive auth window. */
export function refreshDue(credential: OAuthCredential, now: number): boolean {
  return credential.expires <= now + 5 * 60_000
}

/**
 * Refresh the direct ChatGPT OAuth credential without falling back to a legacy client or provider.
 * The caller must hold the row lease. Network work is bounded below its thirty-second lifetime.
 * @throws {@link Error} With REFRESH_REJECTED for terminal reauthentication failures, otherwise a safe retryable error.
 */
export async function refreshChatGPT(
  credential: OAuthCredential,
  now: () => number,
  signal?: AbortSignal,
): Promise<OAuthCredential> {
  if (typeof credential.clientId !== 'string' || !credential.clientId.trim())
    throw new Error(REFRESH_REJECTED)
  const timeout = AbortSignal.timeout(10_000)
  let response: Response
  let body: unknown
  try {
    response = await fetch('https://auth.openai.com/api/accounts/oauth/token', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: credential.clientId,
        refresh_token: credential.refresh,
        resource: 'https://api.openai.com/v1',
      }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      redirect: 'manual',
    })
    body = response.ok ? await response.json() : await response.json().catch(() => undefined)
  } catch {
    throw new Error('credential_unavailable: OAuth refresh request failed')
  }
  if (!response.ok) {
    const parsed = v.safeParse(rejectionSchema, body)
    const code = parsed.success
      ? typeof parsed.output.error === 'string'
        ? parsed.output.error
        : parsed.output.error.code
      : undefined
    if (
      response.status >= 400 &&
      response.status < 500 &&
      response.status !== 429 &&
      (response.status === 401 || (code && permanentErrors.has(code)))
    )
      throw new Error(REFRESH_REJECTED)
    throw new Error('credential_unavailable: OAuth refresh temporarily unavailable')
  }
  const parsed = v.safeParse(tokenSchema, body)
  if (response.status !== 200 || !parsed.success)
    throw new Error('credential_unavailable: invalid OAuth refresh response')
  const token = parsed.output
  const scopes = token.scope === undefined ? credential.scopes : token.scope.trim().split(/\s+/)
  if (!Array.isArray(scopes) || !scopes.includes('chatgpt.tokens.use.direct'))
    throw new Error(REFRESH_REJECTED)
  return {
    ...credential,
    access: token.access_token,
    refresh: token.refresh_token ?? credential.refresh,
    // Match Pi's login payload: keep three minutes of clock/network margin.
    expires: now() + token.expires_in * 1000 - 3 * 60_000,
    scopes,
  }
}
