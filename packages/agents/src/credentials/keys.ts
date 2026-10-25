/** Versioned KEK selection; ordinary installations have only CREDENTIAL_KEK_V1. @module */
import { and, eq, sql } from 'drizzle-orm'
import { systemSettings } from '../../drizzle/management/schema.ts'
import type { AgentEnv } from '../env.ts'
import type { ManagementDb } from '../management/db.ts'

/** KEKs are Worker Secrets, never database values or RPC arguments. */
export type KekEnv = Pick<AgentEnv, 'CREDENTIAL_KEK_V1' | 'CREDENTIAL_KEK_V2'>
/** The durable write-key version switched before the resumable rewrap starts. */
export const KEK_VERSION_KEY = 'credential_kek_version'

/** Refuse missing and unsupported versions instead of trying another key. */
export function kekFor(env: KekEnv, version: number): string {
  const value =
    version === 1 ? env.CREDENTIAL_KEK_V1 : version === 2 ? env.CREDENTIAL_KEK_V2 : undefined
  try {
    if (!value || atob(value).length !== 32) throw new Error()
    return value
  } catch {
    throw new Error('credential_unavailable: encryption key is missing or invalid')
  }
}

/** Abort the enclosing batch if maintenance advanced the write-key version during encryption. */
export function guardKekVersion(db: ManagementDb, version: number) {
  const selected = db
    .select({ value: systemSettings.valueJson })
    .from(systemSettings)
    .where(
      and(eq(systemSettings.key, KEK_VERSION_KEY), eq(systemSettings.valueJson, String(version))),
    )
  // A stale version produces NULL, violating value_json's NOT NULL constraint and rolling back.
  return db
    .update(systemSettings)
    .set({ valueJson: sql`(${selected})` })
    .where(eq(systemSettings.key, KEK_VERSION_KEY))
}

/** All new envelopes follow the durable write-key version, including during maintenance. */
export async function activeKek(db: ManagementDb, env: KekEnv) {
  await db
    .insert(systemSettings)
    .values({ key: KEK_VERSION_KEY, valueJson: '1' })
    .onConflictDoNothing()
  const row = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, KEK_VERSION_KEY))
    .get()
  const version = row ? Number(row.valueJson) : 1
  return { key: kekFor(env, version), version }
}
