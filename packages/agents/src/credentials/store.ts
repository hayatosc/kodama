/**
 * Pi credential storage: explicit version references, live grants, instance-local decrypted cache,
 * and D1 leases for cross-object read-modify-write. No ambient credentials are consulted.
 *
 * @module
 */
import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm'
import type { Credential, CredentialStore } from '@earendil-works/pi-ai'
import { credentials, credentialGrants, auditLog } from '../../drizzle/management/schema.ts'
import type { ManagementDb } from '../management/db.ts'
import type { AgentSettings } from '../protocol.ts'
import { uuidv7 } from '../lib/uuid.ts'
import { auditStatement } from '../management/audit.ts'
import { parseCredential } from './vault.ts'
import { credentialFingerprint, decryptCredential, encryptCredential } from './encryption.ts'

import { REFRESH_REJECTED, refreshChatGPT, refreshDue, reauthCommand } from './refresh.ts'

const LEASE_MS = 30_000

/** Build one object-local store. The settings getter must return the applied version, not desired. */
export function createCredentialStore(
  db: ManagementDb,
  agentId: () => Promise<string>,
  settings: () => Promise<AgentSettings | undefined>,
  kek: () => string,
  now: () => number = Date.now,
): { store: CredentialStore; invalidate: () => void } {
  const cache = new Map<string, { revision: number; value: Credential }>()
  let generation = 0
  const invalidate = () => {
    generation += 1
    cache.clear()
  }

  async function selected(provider: string) {
    const refs = (await settings())?.credentials
    const assigned = Object.values(refs?.primary ?? {})
    if ([...cache.keys()].some((id) => !assigned.includes(id))) invalidate()
    const id = refs?.primary[provider]
    if (!id) return undefined
    const row = await db
      .select({ credential: credentials })
      .from(credentials)
      .innerJoin(
        credentialGrants,
        and(
          eq(credentialGrants.credentialId, credentials.credentialId),
          eq(credentialGrants.agentId, await agentId()),
        ),
      )
      .where(and(eq(credentials.credentialId, id), eq(credentials.provider, provider)))
      .get()
    if (row?.credential.status !== 'active') invalidate()
    return row?.credential
  }

  async function unavailable(provider: string, row?: typeof credentials.$inferSelect) {
    const reason =
      row?.status === 'needs_reauth'
        ? `needs_reauth; reauthCommand: ${reauthCommand(provider, await agentId())}`
        : 'no usable assigned credential'
    return new Error(`credential_unavailable: ${provider}: ${reason}`)
  }

  async function plaintext(row: typeof credentials.$inferSelect): Promise<Credential> {
    if (
      row.ciphertext === null ||
      row.iv === null ||
      row.wrappedDek === null ||
      row.wrapIv === null
    ) {
      throw new Error('credential_unavailable: invalid envelope')
    }
    const value = await decryptCredential(
      row,
      {
        ciphertext: row.ciphertext,
        iv: row.iv,
        wrappedDek: row.wrappedDek,
        wrapIv: row.wrapIv,
      },
      kek(),
    )
    return parseCredential(row.kind, value)
  }

  async function acquire(provider: string, id: string, leaseId: string, signal?: AbortSignal) {
    const deadline = Date.now() + LEASE_MS
    for (;;) {
      signal?.throwIfAborted()
      // A waiter must recheck live permission and the applied reference, not just lease expiry.
      const row = await selected(provider)
      if (row?.status !== 'active') throw await unavailable(provider, row)
      if (row.credentialId !== id)
        throw new Error('credential_unavailable: assigned credential changed')
      const leased = await db
        .update(credentials)
        .set({ leaseId, leaseExpiresAt: now() + LEASE_MS })
        .where(
          and(
            eq(credentials.credentialId, id),
            eq(credentials.status, 'active'),
            or(isNull(credentials.leaseId), lt(credentials.leaseExpiresAt, now())),
          ),
        )
        .returning()
        .get()
      if (leased) return leased
      const delay = Math.min(100, deadline - Date.now())
      if (delay <= 0) throw new Error('credential_unavailable: credential is busy')
      await scheduler.wait(delay, { signal })
    }
  }

  const store: CredentialStore = {
    async read(provider, options) {
      options?.signal?.throwIfAborted()
      const row = await selected(provider)
      if (row?.status !== 'active') throw await unavailable(provider, row)
      const cached = cache.get(row.credentialId)
      if (cached && cached.revision !== row.revision) cache.delete(row.credentialId)
      const before = generation
      const value = cached?.revision === row.revision ? cached.value : await plaintext(row)
      if (value.type === 'oauth' && refreshDue(value, now())) {
        cache.delete(row.credentialId)
        return store.modify(
          provider,
          async (current) => {
            // modify re-reads under the lease; a previous holder may already have rotated the token.
            if (current?.type !== 'oauth' || !refreshDue(current, now())) return undefined
            if (provider !== 'openai')
              throw new Error('credential_unavailable: unsupported OAuth provider')
            return refreshChatGPT(current, now, options?.signal)
          },
          options,
        )
      }
      if (before === generation && cached?.revision !== row.revision)
        cache.set(row.credentialId, { revision: row.revision, value })
      return structuredClone(value)
    },
    async list() {
      const providers = Object.keys((await settings())?.credentials?.primary ?? {})
      const entries = await Promise.all(
        providers.map(async (providerId) => {
          const row = await selected(providerId)
          return row?.status === 'active'
            ? [
                {
                  providerId,
                  type: row.kind === 'api_key' ? ('api_key' as const) : ('oauth' as const),
                },
              ]
            : []
        }),
      )
      return entries.flat()
    },
    async modify(provider, fn, options) {
      options?.signal?.throwIfAborted()
      const selectedRow = await selected(provider)
      if (selectedRow?.status !== 'active') throw await unavailable(provider, selectedRow)
      const id = selectedRow.credentialId
      const leaseId = uuidv7()
      const leased = await acquire(provider, id, leaseId, options?.signal)
      try {
        options?.signal?.throwIfAborted()
        const current = await plaintext(leased)
        const next = await fn(current)
        if (next === undefined) return current
        options?.signal?.throwIfAborted()
        if ((next.type === 'api_key') !== (leased.kind === 'api_key'))
          throw new Error('credential_unavailable: credential kind cannot change')
        const secret = next.type === 'api_key' ? next.key : JSON.stringify(next)
        if (!secret) throw new Error('credential_unavailable: empty credential')
        const value = parseCredential(leased.kind, secret)
        const fingerprint = await credentialFingerprint(secret, kek())
        const token = value.type === 'api_key' ? value.key : value.access
        const revision = leased.revision + 1
        const envelope = await encryptCredential({ ...leased, revision }, secret, kek())
        // Record the attempted refresh in the same batch; a losing CAS must not be reported
        // as a completed refresh. The caller retries only after acquiring a fresh lease.
        const [updated] = await db.batch([
          db
            .update(credentials)
            .set({
              ...envelope,
              revision,
              fingerprint,
              last4: token.length >= 16 ? token.slice(-4) : '',
            })
            .where(
              and(
                eq(credentials.credentialId, id),
                eq(credentials.leaseId, leaseId),
                eq(credentials.revision, leased.revision),
                gt(credentials.leaseExpiresAt, now()),
                eq(credentials.status, 'active'),
              ),
            )
            .returning(),
          auditStatement(db, {
            opId: leaseId,
            at: now(),
            actorId: null,
            action: 'credential.modify.attempt',
            targetKind: 'system',
            targetId: id,
            detail: { kind: leased.kind, provider, fingerprint },
          }),
        ])
        if (!updated.length)
          throw new Error('credential_unavailable: credential changed during refresh')
        invalidate()
        return next
      } catch (error) {
        invalidate()
        if (error instanceof Error && error.message === REFRESH_REJECTED) {
          const at = now()
          const held = and(
            eq(credentials.credentialId, id),
            eq(credentials.leaseId, leaseId),
            eq(credentials.revision, leased.revision),
            eq(credentials.status, 'active'),
            gt(credentials.leaseExpiresAt, at),
          )
          const [, updated] = await db.batch([
            // Audit only a transition this live lease can perform, in the same transaction.
            db.insert(auditLog).select(
              db
                .select({
                  seq: sql<null>`${null}`.as('seq'),
                  opId: sql<string>`${leaseId}`.as('op_id'),
                  at: sql<number>`${at}`.as('at'),
                  actorId: sql<null>`${null}`.as('actor_id'),
                  action: sql<string>`${'credential.needs_reauth'}`.as('action'),
                  targetKind: sql<'system'>`${'system'}`.as('target_kind'),
                  targetId: credentials.credentialId,
                  detailJson: sql<string>`${JSON.stringify({ kind: leased.kind, provider })}`.as(
                    'detail_json',
                  ),
                })
                .from(credentials)
                .where(held),
            ),
            db.update(credentials).set({ status: 'needs_reauth' }).where(held).returning(),
          ])
          const row = updated[0]
          if (row) throw await unavailable(provider, row)
        }
        throw new Error('credential_unavailable: credential modification failed')
      } finally {
        await db
          .update(credentials)
          .set({ leaseId: null, leaseExpiresAt: null })
          .where(and(eq(credentials.credentialId, id), eq(credentials.leaseId, leaseId)))
      }
    },
    async delete() {
      throw new Error('forbidden: revoke credentials through management RPC')
    },
  }
  return { store, invalidate }
}
