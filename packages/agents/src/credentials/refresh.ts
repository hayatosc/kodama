/** ChatGPT subscription refresh protocol; no credential material escapes provider errors. @module */
import type { OAuthCredential } from '@earendil-works/pi-ai'
import * as v from 'valibot'

const tokenSchema = v.object({
  access_token: v.pipe(v.string(), v.minLength(8)),
  refresh_token: v.optional(v.pipe(v.string(), v.minLength(8))),
  expires_in: v.pipe(v.number(), v.finite(), v.minValue(1)),
  scope: v.optional(v.string()),
})
const rejectionSchema = v.object({
  error: v.union([v.string(), v.object({ code: v.string() })]),
})
const permanentErrors = new Set([
  'invalid_grant',
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
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: credential.refresh,
        client_id: credential.clientId,
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
      response.status < 500 &&
      response.status !== 429 &&
      (response.status === 401 || response.status === 403 || (code && permanentErrors.has(code)))
    )
      throw new Error(REFRESH_REJECTED)
    throw new Error('credential_unavailable: OAuth refresh temporarily unavailable')
  }
  const parsed = v.safeParse(tokenSchema, body)
  if (!parsed.success) throw new Error('credential_unavailable: invalid OAuth refresh response')
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
