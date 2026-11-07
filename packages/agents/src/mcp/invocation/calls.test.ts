/** MCP response receipts remain fenced until the corresponding Pi result is durable. @module */
import { evictDurableObject, runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { expect, it } from 'vite-plus/test'
import { mcpCalls } from '../../../drizzle/durable-object/schema.ts'
import { newAgentId } from '../../testing/management.ts'
import { openLocalDb } from '../../agent/local-db/local.ts'
import { beginMcpCall, finishMcpCall, interruptMcpCalls, pruneMcpCalls } from './calls.ts'

it('retains an unacknowledged response fence across eviction and receipt retention', async () => {
  const stub = env.AGENTS.getByName(await newAgentId())
  await runInDurableObject(stub, async (_, state) => {
    const local = await openLocalDb(state.storage)
    // Persist the crash boundary: remote success without a committed Pi completion.
    beginMcpCall(local, '999', 'operator:1', 'read', 1)
    finishMcpCall(local, '999', undefined, 2)
    pruneMcpCalls(local, 'operator:1')
    expect(local.select().from(mcpCalls).get()?.state).toBe('succeeded')
  })
  await evictDurableObject(stub)
  await runInDurableObject(stub, async (_, state) => {
    const local = await openLocalDb(state.storage)
    interruptMcpCalls(local)
    expect(local.select().from(mcpCalls).get()?.state).toBe('outcome_unknown')
    expect(() => beginMcpCall(local, '1000', 'operator:1', 'read')).toThrow(
      'mcp_retry_requires_new_operator_input',
    )
    expect(() => beginMcpCall(local, '1001', 'operator:2', 'read')).not.toThrow()
  })
})
