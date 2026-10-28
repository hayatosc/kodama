/**
 * The object's copy of its registry state decides whether it may make external calls.
 *
 * @module
 */
import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { uuidv7 } from '../lib/uuid.ts'
import type { AgentStatus } from '../protocol.ts'
import { STATUS_KEY, statusRefusal } from './restrictions.ts'

const states = {
  provisioning: true,
  active: true,
  pausing: false,
  paused: false,
  archived: false,
  deleting: false,
  deleted: false,
} satisfies Record<AgentStatus, boolean>

describe('statusRefusal', () => {
  it('allows external calls only while provisioning or active, and before any copy is set', async () => {
    await runInDurableObject(env.AGENTS.getByName(uuidv7()), (_instance, state) => {
      const refusal = statusRefusal(state.storage)
      expect(refusal()).toBeUndefined()
      for (const [status, allowed] of Object.entries(states)) {
        state.storage.kv.put(STATUS_KEY, status)
        if (allowed) expect(refusal()).toBeUndefined()
        else
          expect(refusal()).toBe(
            `agent_restricted: external calls are stopped while the agent is ${status}`,
          )
      }
    })
  })
})
