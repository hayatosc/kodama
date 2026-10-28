/** Development bootstrap registers encrypted keys and assigns working and memory agents. @module */
import { env, exports } from 'cloudflare:workers'
import { expect, it } from 'vitest'
import { seedLocalCredentials } from './bootstrap.ts'
import { management, newAgentId } from '../helper/management.ts'
import { auditLog, agentConfigVersions, credentialGrants } from '../../drizzle/management/schema.ts'
import { sha256Hex } from '../lib/hash.ts'
import { credentialFingerprint } from './encryption.ts'

it('bootstraps idempotently without returning the key', async () => {
  const request = () =>
    new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ openai: 'local-provider-test-key' }),
    })
  const result = await seedLocalCredentials(env, request(), (refs) => exports.default.seed(refs))
  expect(result.seeded.memoryAgentId).toBeTruthy()
  expect(result.credentials.openai).toBeTruthy()
  expect(JSON.stringify(result)).not.toContain('local-provider-test-key')
  const audit = JSON.stringify(await management.select().from(auditLog))
  expect(audit).not.toContain(await sha256Hex('local-provider-test-key'))
  expect(audit).toContain(
    await credentialFingerprint('local-provider-test-key', env.CREDENTIAL_KEK_V1),
  )
  const versions = await management.select().from(agentConfigVersions)
  const grants = await management.select().from(credentialGrants)
  expect(await seedLocalCredentials(env, request(), (refs) => exports.default.seed(refs))).toEqual(
    result,
  )
  expect(await management.select().from(agentConfigVersions)).toEqual(versions)
  expect(await management.select().from(credentialGrants)).toEqual(grants)
})

it('preserves all existing selections and grants when bootstrapped with a different key', async () => {
  const bootstrap = (key: string) =>
    seedLocalCredentials(
      env,
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ openai: key }),
      }),
      (refs) => exports.default.seed(refs),
    )
  await bootstrap('initial-local-provider-key')
  await newAgentId()
  const versions = await management.select().from(agentConfigVersions)
  const grants = await management.select().from(credentialGrants)
  await bootstrap('different-local-provider-key')
  expect(await management.select().from(agentConfigVersions)).toEqual(versions)
  expect(await management.select().from(credentialGrants)).toEqual(grants)
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
