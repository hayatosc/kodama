/** Development bootstrap registers encrypted keys and assigns working and memory agents. @module */
import { env, exports } from 'cloudflare:workers'
import { expect, it } from 'vitest'
import { seedLocalCredentials } from './bootstrap.ts'

it('bootstraps idempotently without returning the key', async () => {
  const request = () =>
    new Request('http://localhost/cli/dev/seed-credentials', {
      method: 'POST',
      body: JSON.stringify({ openai: 'local-provider-test-key' }),
    })
  const result = await seedLocalCredentials(env, request(), (refs) => exports.default.seed(refs))
  expect(result.seeded.memoryAgentId).toBeTruthy()
  expect(result.credentials.openai).toBeTruthy()
  expect(JSON.stringify(result)).not.toContain('local-provider-test-key')
  expect(await seedLocalCredentials(env, request(), (refs) => exports.default.seed(refs))).toEqual(
    result,
  )
})

it('does not echo malformed secret input', async () => {
  await expect(
    seedLocalCredentials(
      env,
      new Request('http://localhost', { method: 'POST', body: 'sk-malformed123456' }),
      (refs) => exports.default.seed(refs),
    ),
  ).rejects.toThrow('Invalid credential JSON')
})
