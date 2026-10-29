/**
 * Helpers of the registry tests: the seed, the caller, registry rows, and configuration changes.
 *
 * @module
 */
import { env, exports } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { agents, principals, agentConfigVersions } from '../../drizzle/management/schema.ts'
import { defaultAgentSettings } from '../control-plane/config.ts'
import { managementDb } from '../control-plane/db.ts'
import { grantTestCredentials, testCredentialRefs } from './credentials.ts'
import { referenceStatements } from '../credentials/references.ts'
import { uuidv7 } from '../lib/uuid.ts'
import type { ManagementActor, AgentSettings, ConfigWriteResult, SeedResult } from '../protocol.ts'

/** The management database of the tests. */
export const management = managementDb(env.MANAGEMENT_DB)

/** The default entrypoint, including its management methods. */
export const agentService = () => exports.default

let seeded: Promise<SeedResult> | undefined

/** The seed's result; the first call of a test file seeds. */
export function seedOnce(): Promise<SeedResult> {
  seeded ??= testCredentialRefs().then((refs) => agentService().seed(refs))
  return seeded
}

/** The caller of the tests, a person; the seed has run before it acts. */
export async function caller(): Promise<ManagementActor> {
  await seedOnce()
  return { kind: 'user', externalId: 'tester@example.com' }
}

/** The principal ID `AgentService` recorded for `actor`. */
export async function principalIdOf(actor: ManagementActor): Promise<string> {
  const row = await management
    .select()
    .from(principals)
    .where(eq(principals.externalId, actor.externalId))
    .get()
  if (row === undefined) throw new Error(`No principal for ${actor.externalId}`)
  return row.principalId
}

/**
 * A new active working agent, written to the registry directly so RPC tests stay fast; its object
 * starts on the first call with the default configuration and no version. Use
 * `agentService().createAgent` to test creation itself.
 */
export async function newAgentId(
  agentId: string = uuidv7(),
  withCredentials = true,
): Promise<string> {
  await seedOnce()
  const now = Date.now()
  await management.insert(agents).values({
    agentId,
    objectName: agentId,
    kind: 'working',
    displayName: `test ${agentId.slice(0, 8)}`,
    status: 'active',
    currentVersion: withCredentials ? 1 : 0,
    createdAt: now,
    updatedAt: now,
  })
  if (!withCredentials) return agentId
  const settings = {
    ...defaultAgentSettings(env),
    credentials: await grantTestCredentials(agentId),
  }
  await management.batch([
    management.insert(agentConfigVersions).values({
      agentId,
      version: 1,
      settingsJson: JSON.stringify(settings),
      schemaVersion: 1,
      authorId: null,
      createdAt: now,
    }),
    ...referenceStatements(management, agentId, settings),
  ])
  return agentId
}

/** The agent's desired settings, or the defaults before its first version. */
export async function desiredSettings(agentId: string): Promise<AgentSettings> {
  const row = await management.select().from(agents).where(eq(agents.agentId, agentId)).get()
  if (row === undefined || row.currentVersion === 0) return defaultAgentSettings(env)
  return (await agentService().getConfig(await caller(), agentId)).settings
}

/** Write a new version with `change` over the desired settings, as the caller. */
export async function updateSettings(
  agentId: string,
  change: Partial<AgentSettings>,
): Promise<ConfigWriteResult> {
  const row = await management.select().from(agents).where(eq(agents.agentId, agentId)).get()
  return agentService().updateConfig(await caller(), agentId, {
    requestId: uuidv7(),
    settings: { ...(await desiredSettings(agentId)), ...change },
    expectedVersion: row?.currentVersion ?? 0,
  })
}
