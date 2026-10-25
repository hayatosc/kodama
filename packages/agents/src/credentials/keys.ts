/** A single Worker KEK, with a durable generation fence for replacement. @module */
import { and, eq, sql } from 'drizzle-orm'
import { systemSettings } from '../../drizzle/management/schema.ts'
import type { AgentEnv } from '../env.ts'
import type { ManagementDb } from '../management/db.ts'
import { sha256Hex } from '../lib/hash.ts'

/** The only configured encryption key. */
export type KekEnv = Pick<AgentEnv, 'CREDENTIAL_KEK_V1'>
/** Durable generation advanced by explicit replacement, not a binding suffix. */
export const KEK_VERSION_KEY = 'credential_kek_version'
/** A one-way key identity prevents writes by Workers with an outdated binding. */
export const KEK_FINGERPRINT_KEY = 'credential_kek_fingerprint'

/** Reject invalid keys without consulting alternate bindings. */
export function kekFor(env: KekEnv): string {
  try {
    if (atob(env.CREDENTIAL_KEK_V1).length !== 32) throw new Error()
    return env.CREDENTIAL_KEK_V1
  } catch {
    throw new Error('credential_unavailable: encryption key is missing or invalid')
  }
}

/** Abort a write batch when replacement advanced the generation during encryption. */
export function guardKekVersion(db: ManagementDb, version: number) {
  const selected = db
    .select({ value: systemSettings.valueJson })
    .from(systemSettings)
    .where(
      and(eq(systemSettings.key, KEK_VERSION_KEY), eq(systemSettings.valueJson, String(version))),
    )
  return db
    .update(systemSettings)
    .set({ valueJson: sql`(${selected})` })
    .where(eq(systemSettings.key, KEK_VERSION_KEY))
}

/** Bind the initial generation once; subsequent binding changes require explicit rewrapping. */
export async function activeKek(db: ManagementDb, env: KekEnv) {
  const key = kekFor(env)
  const fingerprint = JSON.stringify(await sha256Hex(key))
  await db.batch([
    db
      .insert(systemSettings)
      .values({ key: KEK_VERSION_KEY, valueJson: '1' })
      .onConflictDoNothing(),
    db
      .insert(systemSettings)
      .values({ key: KEK_FINGERPRINT_KEY, valueJson: fingerprint })
      .onConflictDoNothing(),
  ])
  const rows = await db.select().from(systemSettings)
  const version = Number(rows.find((row) => row.key === KEK_VERSION_KEY)?.valueJson)
  if (
    !Number.isSafeInteger(version) ||
    version < 1 ||
    rows.find((row) => row.key === KEK_FINGERPRINT_KEY)?.valueJson !== fingerprint
  )
    throw new Error('credential_unavailable: KEK replacement is required')
  return { key, version }
}
