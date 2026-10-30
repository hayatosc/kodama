/** Unconditional known-URL admission and legacy metadata across eviction. @module */
import { evictDurableObject, runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { expect, it } from 'vitest'
import { newAgentId } from '../../testing/management.ts'
import { openLocalDb } from './local.ts'
import {
  KNOWN_URL_LIMIT,
  admitWeb,
  contactBoundary,
  grantUrls,
  isKnownUrl,
  markContact,
} from './external-data.ts'

it('requires known URLs from the first fetch, repeatedly and across eviction', async () => {
  const id = await newAgentId()
  const stub = env.AGENTS.getByName(id)
  const call = (
    local: Awaited<ReturnType<typeof openLocalDb>>,
    argument: string,
    tool: 'web_search' | 'web_fetch' = 'web_fetch',
    root = 'root',
  ) => admitWeb(local, { root, tool, argument })
  await runInDurableObject(stub, async (_, state) => {
    const local = await openLocalDb(state.storage)
    expect(() => call(local, 'https://example.org/first')).toThrow('unverified_url')
    expect(contactBoundary(local, 'root')).toBeUndefined()
    markContact(local, 'root', 'peer', 99)
    expect(contactBoundary(local, 'root')).toBe(99)
    expect(() => call(local, 'https://example.org/link')).toThrow('unverified_url')
    call(local, 'any query', 'web_search')
    grantUrls(local, 'root', 'search', ['https://example.org/source'])
    grantUrls(local, 'root', 'owner', ['https://example.org/owner'])
    for (let attempt = 0; attempt < 2; attempt++) {
      call(local, 'https://example.org/source')
      call(local, 'https://example.org/owner')
    }
    expect(() => call(local, 'https://example.org/first')).toThrow('unverified_url')
    expect(() => call(local, 'https://example.org/link', 'web_fetch', 'other')).toThrow(
      'unverified_url',
    )
    expect(() => call(local, 'https://example.org/source', 'web_fetch', 'other')).toThrow(
      'unverified_url',
    )
  })
  await evictDurableObject(stub)
  await runInDurableObject(stub, async (_, state) => {
    const local = await openLocalDb(state.storage)
    expect(contactBoundary(local, 'root')).toBe(99)
    call(local, 'https://example.org/source')
    expect(() => call(local, 'https://example.org/link')).toThrow('unverified_url')
  })
})

it('keeps the most recently granted known URLs per root', async () => {
  const stub = env.AGENTS.getByName(await newAgentId())
  await runInDurableObject(stub, async (_, state) => {
    const local = await openLocalDb(state.storage)
    const urls = Array.from(
      { length: KNOWN_URL_LIMIT + 1 },
      (_, index) => `https://example.org/${index}`,
    )
    grantUrls(local, 'root', 'search', urls.slice(0, KNOWN_URL_LIMIT), 1)
    grantUrls(local, 'root', 'search', ['https://example.org/0'], 2)
    grantUrls(local, 'root', 'search', [`https://example.org/${KNOWN_URL_LIMIT}`], 3)
    expect(isKnownUrl(local, 'root', 'https://example.org/0')).toBe(true)
    expect(isKnownUrl(local, 'root', `https://example.org/${KNOWN_URL_LIMIT}`)).toBe(true)
    const kept = urls.filter((url) => isKnownUrl(local, 'root', url))
    expect(kept).toHaveLength(KNOWN_URL_LIMIT)
  })
})
