/**
 * Helpers of the registry tests: the seed, the owner, registry rows, and configuration changes.
 *
 * @module
 */
import { env, exports } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { agents } from '../../drizzle/control/schema.ts'
import { defaultAgentSettings } from '../configuration/index.ts'
import { controlDb } from '../control/db.ts'
import { uuidv7 } from '../lib/uuid.ts'
import type { AdminActor, AgentSettings, ConfigWriteResult, SeedResult } from '../protocol.ts'

/** The control database of the tests. */
export const control = controlDb(env.CONTROL_DB)

/** The administration entrypoint. */
export const admin = () => exports.AdminService

let seeded: Promise<SeedResult> | undefined

/** The seed's result; the first call of a test file seeds. */
export function seedOnce(): Promise<SeedResult> {
  seeded ??= admin().seed()
  return seeded
}

/** The installation owner: the administrator agent the seed registers. */
export async function owner(): Promise<AdminActor> {
  return { kind: 'agent', externalId: (await seedOnce()).adminAgentId }
}

/**
 * A new active working agent, written to the registry directly so RPC tests stay fast; its object
 * starts on the first call with the default configuration and no version. Use
 * `admin().createAgent` to test creation itself.
 */
export async function newAgentId(agentId: string = uuidv7()): Promise<string> {
  const now = Date.now()
  await control.insert(agents).values({
    agentId,
    objectName: agentId,
    kind: 'working',
    displayName: `test ${agentId.slice(0, 8)}`,
    status: 'active',
    currentVersion: 0,
    createdAt: now,
    updatedAt: now,
  })
  return agentId
}

/** The agent's desired settings, or the defaults before its first version. */
export async function desiredSettings(agentId: string): Promise<AgentSettings> {
  const row = await control.select().from(agents).where(eq(agents.agentId, agentId)).get()
  if (row === undefined || row.currentVersion === 0) return defaultAgentSettings(env)
  return (await admin().getConfig(await owner(), agentId)).settings
}

/** Write a new version with `change` over the desired settings, as the owner. */
export async function updateSettings(
  agentId: string,
  change: Partial<AgentSettings>,
): Promise<ConfigWriteResult> {
  const row = await control.select().from(agents).where(eq(agents.agentId, agentId)).get()
  return admin().updateConfig(await owner(), agentId, {
    requestId: crypto.randomUUID(),
    settings: { ...(await desiredSettings(agentId)), ...change },
    expectedVersion: row?.currentVersion ?? 0,
  })
}
