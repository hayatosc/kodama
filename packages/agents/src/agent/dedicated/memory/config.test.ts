/** The memory agent has a dedicated registry, without working-agent contact capabilities. @module */
import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { beforeAll, expect, it } from 'vitest'
import { memoryAgent } from '../../../testing/memory.ts'
import { createMemoryAgentTools } from './config.ts'
import { seedOnce } from '../../../testing/management.ts'

// The memory agent needs the seeded installation and its credentials.
beforeAll(seedOnce)

it('never registers contact_agent in the memory agent tool set', async () => {
  const names = await runInDurableObject(memoryAgent(), (_instance, state) =>
    createMemoryAgentTools({
      env: { ...env, CLI_TOKEN: '' },
      storage: state.storage,
      runningJob: async () => undefined,
    }).map((tool) => tool.name),
  )
  expect(names.length).toBeGreaterThan(0)
  expect(names).not.toContain('contact_agent')
})
