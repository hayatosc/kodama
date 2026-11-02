/** Bounded OAuth discovery and endpoint-bound exchanges. No request is automatically retried.
 * Metadata is untrusted and never receives credentials.
 * @module
 */
import * as v from 'valibot'
import { mcpEndpoint } from '../tools/mcp/transport.ts'
import { decodeUtf8, parseJson, readBody } from '../tools/web/stream.ts'

const https = v.pipe(
  v.string(),
  v.check((value) => {
    try {
      mcpEndpoint(value)
      return true
    } catch {
      return false
    }
  }),
)
const stringList = v.array(v.string())
const resourceSchema = v.looseObject({ resource: https, authorization_servers: v.array(https) })
const metadataSchema = v.looseObject({
  issuer: https,
  authorization_endpoint: https,
  token_endpoint: https,
  registration_endpoint: v.optional(https),
  revocation_endpoint: v.optional(https),
  code_challenge_methods_supported: stringList,
  response_types_supported: stringList,
  grant_types_supported: v.optional(stringList),
  token_endpoint_auth_methods_supported: v.optional(stringList, ['client_secret_basic']),
  client_id_metadata_document_supported: v.optional(v.boolean(), false),
})

/** Immutable issuer endpoints presented to the owner before authorization. */
export type McpOAuthMetadata = v.InferOutput<typeof metadataSchema>

/** Reject missing configuration rather than constructing a callback from a request Host. */
export function mcpUiOrigin(value: string): string {
  const url = new URL(mcpEndpoint(value))
  if (url.pathname !== '/') throw new Error('mcp_ui_origin_invalid')
  return url.origin
}

/** Fixed metadata contract for the future UI Worker's public static route. */
export function mcpClientDocument(origin: string) {
  const base = mcpUiOrigin(origin)
  return {
    client_id: `${base}/oauth/mcp-client.json`,
    client_name: 'Kodama',
    redirect_uris: [`${base}/auth/mcp/callback`],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }
}

async function metadata(url: string, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted()
  const response = await fetch(mcpEndpoint(url), {
    redirect: 'error',
    signal,
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    if (response.status === 404) return undefined
    throw new Error('mcp_auth_discovery_failed')
  }
  return parseJson(decodeUtf8(await readBody(response, 65_536, signal)))
}

/** Discover resource and AS metadata with exact resource and issuer pinning. */
export async function discoverMcpOAuth(
  endpoint: string,
  selectedIssuer: string | undefined,
  signal: AbortSignal,
) {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(10_000)])
  const resourceUrl = new URL(mcpEndpoint(endpoint))
  try {
    bounded.throwIfAborted()
    const challenge = await fetch(resourceUrl.href, {
      method: 'GET',
      redirect: 'error',
      signal: bounded,
      headers: { Accept: 'application/json' },
    })
    const header = challenge.headers.get('WWW-Authenticate')
    await challenge.body?.cancel().catch(() => undefined)
    const hint = header?.match(/\bresource_metadata="([^"\r\n]+)"/iu)?.[1]
    const paths = hint
      ? [mcpEndpoint(hint)]
      : [
          `${resourceUrl.origin}/.well-known/oauth-protected-resource${resourceUrl.pathname === '/' ? '' : resourceUrl.pathname}`,
          `${resourceUrl.origin}/.well-known/oauth-protected-resource`,
        ]
    let resource: v.InferOutput<typeof resourceSchema> | undefined
    for (const url of new Set(paths)) {
      const result = await metadata(url, bounded)
      if (result !== undefined) {
        resource = v.parse(resourceSchema, result)
        break
      }
    }
    if (!resource || resource.resource !== resourceUrl.href)
      throw new Error('mcp_resource_mismatch')
    const issuer =
      selectedIssuer ??
      (resource.authorization_servers.length === 1 ? resource.authorization_servers[0] : undefined)
    if (!issuer || !resource.authorization_servers.includes(issuer))
      throw new Error('mcp_issuer_selection_required')
    const base = new URL(issuer)
    const suffix = base.pathname === '/' ? '' : base.pathname
    const locations = [
      `${base.origin}/.well-known/oauth-authorization-server${suffix}`,
      `${base.origin}/.well-known/openid-configuration${suffix}`,
      `${issuer.replace(/\/$/u, '')}/.well-known/openid-configuration`,
    ]
    for (const url of new Set(locations)) {
      const result = await metadata(url, bounded)
      if (result === undefined) continue
      const server = v.parse(metadataSchema, result)
      if (server.issuer !== issuer) throw new Error('mcp_issuer_mismatch')
      if (
        !server.code_challenge_methods_supported.includes('S256') ||
        !server.response_types_supported.includes('code') ||
        (server.grant_types_supported &&
          !server.grant_types_supported.includes('authorization_code'))
      )
        throw new Error('mcp_oauth_unsupported')
      return { resource: resource.resource, metadata: server }
    }
    throw new Error('mcp_auth_discovery_failed')
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('mcp_')) throw error
    throw new Error(bounded.aborted ? 'mcp_timeout' : 'mcp_auth_discovery_failed')
  }
}

/** Validated issuer-bound client identity; client secrets are provided only by the vault. */
export const mcpClientSchema = v.strictObject({
  issuer: https,
  clientId: v.pipe(v.string(), v.minLength(1), v.maxLength(2_048)),
  method: v.picklist(['none', 'client_secret_basic', 'client_secret_post']),
  redirectUri: https,
  registration: v.picklist(['preregistered', 'metadata', 'dynamic']),
})
/** Client metadata carries no secrets. */
export type McpOAuthClient = v.InferOutput<typeof mcpClientSchema>

/** Prepare client authentication without placing secrets into a URL. */
export function mcpClientAuthentication(client: McpOAuthClient, secret?: string) {
  const headers = new Headers({
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  })
  const body = new URLSearchParams({ client_id: client.clientId })
  if (client.method !== 'none') {
    if (!secret) throw new Error('mcp_client_secret_required')
    if (client.method === 'client_secret_post') body.set('client_secret', secret)
    else {
      const encode = (value: string) => new URLSearchParams({ x: value }).toString().slice(2)
      headers.set('Authorization', `Basic ${btoa(`${encode(client.clientId)}:${encode(secret)}`)}`)
    }
  }
  return { headers, body }
}

const tokenSchema = v.looseObject({
  access_token: v.pipe(v.string(), v.minLength(1), v.maxLength(16_384), v.regex(/^[\x21-\x7e]+$/u)),
  token_type: v.pipe(
    v.string(),
    v.check((value) => value.toLowerCase() === 'bearer'),
  ),
  refresh_token: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(16_384))),
  expires_in: v.optional(v.pipe(v.number(), v.finite(), v.minValue(1))),
  scope: v.optional(v.string()),
})

/** Exactly one token request; unknown outcomes must transition to reauthentication, not retry. */
export async function exchangeMcpToken(
  endpoint: string,
  client: McpOAuthClient,
  secret: string | undefined,
  fields: Record<string, string>,
  signal: AbortSignal,
) {
  try {
    const { body, headers } = mcpClientAuthentication(client, secret)
    for (const [key, value] of Object.entries(fields)) body.set(key, value)
    signal.throwIfAborted()
    const response = await fetch(mcpEndpoint(endpoint), {
      method: 'POST',
      redirect: 'error',
      headers,
      body,
      signal,
    })
    const bytes = await readBody(response, 65_536, signal)
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) throw new Error('mcp_reauth_required')
      throw new Error('mcp_auth_outcome_unknown')
    }
    return v.parse(tokenSchema, parseJson(decodeUtf8(bytes)))
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('mcp_')) throw error
    throw new Error('mcp_auth_outcome_unknown')
  }
}

/** One explicit DCR operation. The caller persists its claim before issuing this request. */
export async function registerMcpOAuthClient(
  endpoint: string,
  origin: string,
  initialToken: string | undefined,
  signal: AbortSignal,
) {
  try {
    const document = mcpClientDocument(origin)
    const headers = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' })
    if (initialToken) headers.set('Authorization', `Bearer ${initialToken}`)
    signal.throwIfAborted()
    const response = await fetch(mcpEndpoint(endpoint), {
      method: 'POST',
      redirect: 'error',
      signal,
      headers,
      body: JSON.stringify({
        client_name: document.client_name,
        application_type: 'web',
        redirect_uris: document.redirect_uris,
        grant_types: document.grant_types,
        response_types: document.response_types,
        token_endpoint_auth_method: 'none',
      }),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error('mcp_client_registration_failed')
    }
    const result = v.parse(
      v.looseObject({
        client_id: v.pipe(v.string(), v.minLength(1)),
        client_secret: v.optional(v.string()),
        token_endpoint_auth_method: v.optional(
          v.picklist(['none', 'client_secret_basic', 'client_secret_post']),
          'none',
        ),
        redirect_uris: v.array(v.string()),
      }),
      parseJson(decodeUtf8(await readBody(response, 65_536, signal))),
    )
    if (result.redirect_uris.length !== 1 || result.redirect_uris[0] !== document.redirect_uris[0])
      throw new Error('mcp_redirect_mismatch')
    return result
  } catch {
    throw new Error('mcp_client_registration_failed')
  }
}
