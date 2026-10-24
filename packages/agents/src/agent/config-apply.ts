/**
 * Applying configuration versions in the object: at once when idle, otherwise held until the object
 * is next idle. Versions are idempotent by number, and a version counts as applied only once every
 * part of it has succeeded.
 *
 * @see docs/agents.md — Applying versions
 *
 * @module
 */
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { configure, ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import type { AgentChange, Harness } from '@earendil-works/pi-durable'
import { SHARED_SPACES_KEY } from '../configuration/index.ts'
import type { ControlDb } from '../control/db.ts'
import { agentRowByObjectName } from '../control/registry.ts'
import { versionRow } from '../control/versions.ts'
import type { AgentSettings, ApplyResult } from '../protocol.ts'
import { isIdle } from './harness.ts'

/** The version the object has fully applied. */
export const CONFIG_VERSION_KEY = 'kodama:config-version'
/** The settings of that version. */
export const APPLIED_SETTINGS_KEY = 'kodama:applied-settings'
/** A version that arrived while the object was busy, or whose apply failed. */
export const PENDING_CONFIG_KEY = 'kodama:pending-config'
/** The registry ID of the agent, for reports. */
export const AGENT_ID_KEY = 'kodama:agent-id'

/** A version pushed to the object. */
export interface PushedConfig {
  agentId: string
  version: number
  settings: AgentSettings
}

/** What applying needs from the object. */
export interface ApplyDeps {
  storage: DurableObjectStorage
  harness: Harness
  /** How the settings become Pi's change; the memory agent has its own. */
  change: (settings: AgentSettings) => AgentChange
  /** Rebuild the always-loaded memory for the settings; throws when it fails. */
  rebuildMemory: (settings: AgentSettings) => Promise<void>
  /** Record the applied version in the registry; a failure is left to reconciliation. */
  report: (agentId: string, version: number) => Promise<void>
}

/** The version this object has fully applied, or 0. */
export async function appliedVersion(storage: DurableObjectStorage): Promise<number> {
  return (await storage.get<number>(CONFIG_VERSION_KEY)) ?? 0
}

/** The settings this object has fully applied, if any. */
export function appliedSettings(storage: DurableObjectStorage): Promise<AgentSettings | undefined> {
  return storage.get<AgentSettings>(APPLIED_SETTINGS_KEY)
}

/** Hold `pushed` unless a newer version is held already. */
async function hold(storage: DurableObjectStorage, pushed: PushedConfig): Promise<void> {
  const held = await storage.get<PushedConfig>(PENDING_CONFIG_KEY)
  if (held === undefined || held.version < pushed.version) {
    await storage.put(PENDING_CONFIG_KEY, pushed)
  }
}

/**
 * Apply `pushed` now if the object is idle, else hold it for the next idle moment.
 *
 * @remarks
 * Run it in the object's serial queue, together with admissions, so no input is admitted between
 * the idle check and the apply. A failed apply stays held, so it is retried.
 */
export async function applyOrHold(deps: ApplyDeps, pushed: PushedConfig): Promise<ApplyResult> {
  const applied = await appliedVersion(deps.storage)
  if (pushed.version <= applied) return { state: 'stale', appliedVersion: applied }
  await hold(deps.storage, pushed)
  if (!(await isIdle(deps.harness))) return { state: 'pending', appliedVersion: applied }
  return applyHeld(deps)
}

/**
 * Apply the held version, if any, while idle.
 *
 * @remarks
 * Called on the idle path, which already runs in the serial queue; entering the queue again from
 * there would wait on itself.
 */
export async function applyPending(deps: ApplyDeps): Promise<ApplyResult> {
  const applied = await appliedVersion(deps.storage)
  const held = await deps.storage.get<PushedConfig>(PENDING_CONFIG_KEY)
  if (held === undefined) return { state: 'stale', appliedVersion: applied }
  if (held.version <= applied) {
    await deps.storage.delete(PENDING_CONFIG_KEY)
    return { state: 'stale', appliedVersion: applied }
  }
  if (!(await isIdle(deps.harness))) return { state: 'pending', appliedVersion: applied }
  return applyHeld(deps)
}

async function applyHeld(deps: ApplyDeps): Promise<ApplyResult> {
  const held = await deps.storage.get<PushedConfig>(PENDING_CONFIG_KEY)
  const applied = await appliedVersion(deps.storage)
  if (held === undefined) return { state: 'stale', appliedVersion: applied }
  try {
    await applyAll(deps, held)
  } catch (error) {
    console.error(`Applying configuration version ${held.version} failed`, error)
    return { state: 'failed', appliedVersion: applied }
  }
  await deps.report(held.agentId, held.version).catch((error: unknown) => {
    console.error('Reporting the applied configuration failed', error)
  })
  return { state: 'applied', appliedVersion: held.version }
}

/**
 * Every part of one version, then the version number with the settings it describes. A failure
 * before the last write leaves the previous version recorded and the held one in place.
 */
async function applyAll(deps: ApplyDeps, { agentId, version, settings }: PushedConfig) {
  await deps.rebuildMemory(settings)
  await deps.harness.commit(
    (tx) => configure(tx, ROOT_CONVERSATION_ID, deps.change(settings)),
    BACKGROUND_CONTEXT,
  )
  // One multi-key put is atomic: the version is written together with the copy it describes.
  await deps.storage.put({
    [SHARED_SPACES_KEY]: [...settings.sharedSpaces],
    [APPLIED_SETTINGS_KEY]: settings,
    [AGENT_ID_KEY]: agentId,
    [CONFIG_VERSION_KEY]: version,
  })
  const held = await deps.storage.get<PushedConfig>(PENDING_CONFIG_KEY)
  if (held !== undefined && held.version <= version) await deps.storage.delete(PENDING_CONFIG_KEY)
}

/** What catching up with the registry needs, besides applying. */
export interface PullDeps {
  db: ControlDb
  objectName: string
  /** Validate stored settings as they are applied. */
  parse: (value: unknown) => AgentSettings
}

/**
 * Catch up with the registry when the harness opens: if the desired version is newer than the one
 * applied here, apply it or hold it. Lost pushes are recovered this way, and by reconciliation.
 *
 * @remarks
 * An object the registry does not know, such as one a test reaches directly, keeps what it has.
 */
export async function pullIfBehind(deps: ApplyDeps, pull: PullDeps): Promise<void> {
  const row = await agentRowByObjectName(pull.db, pull.objectName)
  if (row === undefined) return
  if (row.currentVersion <= (await appliedVersion(deps.storage))) return
  const stored = await versionRow(pull.db, row.agentId, row.currentVersion)
  if (stored === undefined) return
  const settings = pull.parse(JSON.parse(stored.settingsJson))
  await applyOrHold(deps, { agentId: row.agentId, version: stored.version, settings })
}
