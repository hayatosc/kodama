/** MCP-purpose envelopes in the existing credential vault, isolated from model-provider access.
 * Private management and live per-agent grants are distinct from server-bound token resolution.
 * @module
 */
import { and, eq } from 'drizzle-orm'
import * as v from 'valibot'
import { credentials, credentialGrants, agents } from '../../../drizzle/management/schema.ts'
import type { ManagementDb } from '../../control-plane/db.ts'
import { mcpServer } from '../registration/catalog.ts'
import { auditStatement } from '../../control-plane/audit.ts'
import { uuidv7 } from '../../lib/uuid.ts'
import {
  credentialFingerprint,
  decryptCredential,
  encryptCredential,
} from '../../credentials/encryption.ts'
import { mcpClientSchema } from './oauth-http.ts'

const token = v.pipe(v.string(), v.minLength(1), v.maxLength(16_384))
const binding = {
  serverId: v.string(),
  serverRevision: v.number(),
  endpoint: v.string(),
  access: v.pipe(token, v.regex(/^[\x21-\x7e]+$/u)),
  expiresAt: v.nullable(v.number()),
}
/** Payload validation is independent from Pi's provider credential decoder. */
export const mcpTokenSchema = v.variant('kind', [
  v.strictObject({ kind: v.literal('mcp_bearer'), ...binding }),
  v.strictObject({
    kind: v.literal('mcp_oauth'),
    ...binding,
    refresh: v.optional(token),
    scope: v.string(),
    resource: v.string(),
    issuer: v.string(),
    tokenEndpoint: v.string(),
    revocationEndpoint: v.optional(v.string()),
    client: mcpClientSchema,
    clientSecretId: v.optional(v.string()),
  }),
])
/** Only this validated payload may be supplied to the MCP authorization resolver. */
export type McpToken = v.InferOutput<typeof mcpTokenSchema>

/** Bind a client secret to its exact client and issuer inside the server-bound encrypted payload. */
export function mcpClientSecretPayload(
  client: v.InferOutput<typeof mcpClientSchema>,
  secret: string,
) {
  return JSON.stringify({ client, secret })
}

/** Release a client secret only to the exact client recorded in the transaction or token envelope. */
export async function mcpClientSecret(
  db: ManagementDb,
  kek: string,
  serverId: string,
  credentialId: string | undefined,
  client: v.InferOutput<typeof mcpClientSchema>,
): Promise<string | undefined> {
  if (!credentialId) return undefined
  const stored = await mcpSecret(db, kek, serverId, credentialId)
  if (stored.row.kind !== 'mcp_client') throw new Error('mcp_auth_binding_invalid')
  const raw: unknown = JSON.parse(stored.secret)
  const value = v.parse(v.strictObject({ client: mcpClientSchema, secret: token }), raw)
  if (
    value.client.issuer !== client.issuer ||
    value.client.clientId !== client.clientId ||
    value.client.redirectUri !== client.redirectUri ||
    value.client.method !== client.method
  )
    throw new Error('mcp_auth_binding_invalid')
  return value.secret
}

/** Prepare an MCP envelope insert for an atomic workflow batch. Never return its row through RPC. */
export async function mcpSecretInsert(
  db: ManagementDb,
  kek: string,
  serverId: string,
  kind: 'mcp_bearer' | 'mcp_oauth' | 'mcp_client' | 'mcp_transaction',
  secret: string,
  now: number,
  expiresAt: number | null = null,
) {
  if (!secret || new TextEncoder().encode(secret).length > 65_536)
    throw new Error('mcp_secret_invalid')
  const identity = {
    credentialId: uuidv7(now),
    purpose: 'mcp_server' as const,
    kind,
    provider: serverId,
    revision: 1,
  }
  const envelope = await encryptCredential(identity, secret, kek)
  return {
    credentialId: identity.credentialId,
    statement: db.insert(credentials).values({
      ...identity,
      ...envelope,
      fingerprint: await credentialFingerprint(secret, kek),
      last4: '',
      status: 'active',
      createdAt: now,
      expiresAt,
    }),
  }
}

/** Read a server-bound envelope with live revocation checks, never a provider row. */
export async function mcpSecret(
  db: ManagementDb,
  kek: string,
  serverId: string,
  credentialId: string,
) {
  const row = await db
    .select()
    .from(credentials)
    .where(
      and(
        eq(credentials.credentialId, credentialId),
        eq(credentials.purpose, 'mcp_server'),
        eq(credentials.provider, serverId),
      ),
    )
    .get()
  if (
    !row ||
    row.status !== 'active' ||
    row.ciphertext === null ||
    row.iv === null ||
    row.wrappedDek === null ||
    row.wrapIv === null
  )
    throw new Error('mcp_auth_required')
  const secret = await decryptCredential(
    row,
    {
      ciphertext: row.ciphertext,
      iv: row.iv,
      wrappedDek: row.wrappedDek,
      wrapIv: row.wrapIv,
    },
    kek,
  )
  return { row, secret }
}

/** Validate the live server binding before releasing a token; registration need not yet be enabled for discovery. */
export async function mcpToken(
  db: ManagementDb,
  kek: string,
  serverId: string,
  credentialId: string,
) {
  const stored = await mcpSecret(db, kek, serverId, credentialId)
  const parsed = v.safeParse(
    mcpTokenSchema,
    (() => {
      try {
        const value: unknown = JSON.parse(stored.secret)
        return value
      } catch {
        return undefined
      }
    })(),
  )
  if (!parsed.success || parsed.output.kind !== stored.row.kind)
    throw new Error('mcp_auth_required')
  const server = await mcpServer(db, serverId)
  const value = parsed.output
  if (
    value.serverId !== serverId ||
    value.serverRevision !== server.revision ||
    value.endpoint !== server.endpoint ||
    (value.kind === 'mcp_oauth' &&
      (value.resource !== server.endpoint || value.issuer !== value.client.issuer))
  )
    throw new Error('mcp_auth_binding_changed')
  return { row: stored.row, value, server }
}

/** Agent execution needs an active working agent and a live grant, not merely a config reference. */
export async function mcpAgentGrant(db: ManagementDb, agentId: string, credentialId: string) {
  const agent = await db
    .select()
    .from(agents)
    .where(
      and(eq(agents.agentId, agentId), eq(agents.kind, 'working'), eq(agents.status, 'active')),
    )
    .get()
  const grant = await db
    .select()
    .from(credentialGrants)
    .where(
      and(eq(credentialGrants.credentialId, credentialId), eq(credentialGrants.agentId, agentId)),
    )
    .get()
  if (!agent || !grant) throw new Error('mcp_assignment_revoked')
}

/** Register a fixed bearer token without granting it to any agent. */
export async function putMcpBearer(
  db: ManagementDb,
  kek: string,
  serverId: string,
  secret: string,
  now = Date.now(),
) {
  const server = await mcpServer(db, serverId)
  const parsed = v.safeParse(mcpTokenSchema, {
    kind: 'mcp_bearer',
    serverId,
    serverRevision: server.revision,
    endpoint: server.endpoint,
    access: secret,
    expiresAt: null,
  })
  if (!parsed.success) throw new TypeError('mcp_secret_invalid')
  const insert = await mcpSecretInsert(
    db,
    kek,
    serverId,
    'mcp_bearer',
    JSON.stringify(parsed.output),
    now,
  )
  await db.batch([
    insert.statement,
    auditStatement(db, {
      opId: `mcp.credential:${insert.credentialId}`,
      at: now,
      source: 'operator',
      action: 'mcp.credential.create',
      targetKind: 'system',
      targetId: serverId,
      detail: { credentialId: insert.credentialId, kind: 'mcp_bearer', revision: server.revision },
    }),
  ])
  return { credentialId: insert.credentialId, status: 'active' as const, expiryKnown: false }
}

/** Remove encrypted bytes and leases; callers compose this with state changes in one D1 batch. */
export function eraseMcpSecret(db: ManagementDb, credentialId: string, now: number) {
  return db
    .update(credentials)
    .set({
      status: 'revoked',
      ciphertext: null,
      iv: null,
      wrappedDek: null,
      wrapIv: null,
      leaseId: null,
      leaseExpiresAt: null,
      revokedAt: now,
    })
    .where(and(eq(credentials.credentialId, credentialId), eq(credentials.purpose, 'mcp_server')))
}
