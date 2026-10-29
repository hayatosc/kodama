/** Open a real Pi harness on an otherwise passive test object's SQLite. @module */
import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { Harness } from '@earendil-works/pi-durable'
import type { HarnessOptions } from '@earendil-works/pi-durable'
import { openDurableObjectSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/cloudflare'
import { createAgentOptions } from '../agent/config.ts'
import { testCredentialStore } from './credentials.ts'
import { newAgentId } from './management.ts'

/** Keep the object's own harness passive; submit only through the supplied harness. */
export async function withHarness<T>(
  settings: HarnessOptions['settings'],
  run: (harness: Harness, state: DurableObjectState) => Promise<T>,
): Promise<T> {
  const agentId = await newAgentId()
  return runInDurableObject(env.AGENTS.getByName(agentId), async (_instance, state) => {
    const options = createAgentOptions(env, [], undefined, await testCredentialStore(agentId))
    const storage = await openDurableObjectSqliteStorage(state.storage)
    const harness = await Harness.open(
      storage,
      { ...options, settings: { ...options.settings, ...settings } },
      BACKGROUND_CONTEXT,
    )
    try {
      return await run(harness, state)
    } finally {
      await harness.close(BACKGROUND_CONTEXT)
    }
  })
}
