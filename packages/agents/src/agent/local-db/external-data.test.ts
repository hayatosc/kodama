/** Atomic contact and adopted-input permission consumption across eviction. @module */
import { evictDurableObject, runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { expect, it } from 'vitest'
import { newAgentId } from '../../testing/management.ts'
import { openLocalDb } from './local.ts'
import {
  adoptPermissions,
  admitWeb,
  contactBoundary,
  grantSources,
  markContact,
  requireTrusted,
} from './external-data.ts'

it('consumes exact adopted permissions once, retains the first boundary across eviction and rejects another run', async () => {
  const id = await newAgentId()
  const stub = env.AGENTS.getByName(id)
  await runInDurableObject(stub, async (_, state) => {
    const local = await openLocalDb(state.storage)
    const call = (
      argument: string,
      run = 'run',
      inputs = [1],
      tool: 'web_search' | 'web_fetch' = 'web_search',
    ) =>
      admitWeb(local, {
        root: 'root',
        run,
        inputs,
        argument,
        tool,
        eligibleThrough: 50,
      })
    expect(call('first')).toBeNull()
    expect(contactBoundary(local, 'root')).toBe(50)
    markContact(local, 'root', 'peer', 99)
    expect(contactBoundary(local, 'root')).toBe(50)
    expect(() => requireTrusted(local, 'root')).toThrow('untrusted_context')
    adoptPermissions(local, 'root', 'run', 1, { queries: ['exact', 'unused'] })
    expect(() => call('exact ', 'run')).toThrow('untrusted_context')
    expect(() => call('exact', 'run', [2])).toThrow('untrusted_context')
    expect(() => call('unused', 'next')).toThrow('untrusted_context')
    expect(call('exact')).toBeTypeOf('string')
    adoptPermissions(local, 'root', 'next', 1, { queries: ['exact', 'unused'] })
    expect(() => call('exact')).toThrow('untrusted_context')
    expect(() => call('unused', 'next')).toThrow('untrusted_context')
    grantSources(local, 'root', 'run', ['https://example.org/'])
    expect(call('https://example.org/', 'run', [], 'web_fetch')).toBeTypeOf('string')
    expect(() => call('https://example.org/', 'run', [], 'web_fetch')).toThrow('untrusted_context')
    expect(() => call('https://example.org/link', 'run', [], 'web_fetch')).toThrow(
      'untrusted_context',
    )
  })
  await evictDurableObject(stub)
  await runInDurableObject(stub, async (_, state) => {
    const local = await openLocalDb(state.storage)
    expect(contactBoundary(local, 'root')).toBe(50)
    expect(() => requireTrusted(local, 'root')).toThrow('untrusted_context')
    expect(() =>
      admitWeb(local, {
        root: 'root',
        run: 'run',
        inputs: [1],
        argument: 'exact',
        tool: 'web_search',
        eligibleThrough: 99,
      }),
    ).toThrow('untrusted_context')
  })
})
