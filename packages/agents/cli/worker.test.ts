/**
 * The development Worker serves the CLI adapter in place of the service's HTTP refusal.
 *
 * @module
 */
import { createExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { expect, it } from 'vitest'
import { AgentObject } from '../src/agent-object.ts'
import AgentService from '../src/index.ts'
import CliService, { Agent } from './worker.ts'

it('answers HTTP through the token-checked CLI adapter', async () => {
  // Outside development the Worker's token is empty, so the adapter admits no request.
  const service = new CliService(createExecutionContext(), { ...env, CLI_TOKEN: '' })

  const response = await service.fetch(new Request('http://localhost/cli/seed', { method: 'POST' }))

  expect(response.status).toBe(401)
})

it('refuses local credential bootstrap whenever the Worker has no CLI token', async () => {
  // Outside development the token is empty, so even a bearer header with an empty token fails.
  const service = new CliService(createExecutionContext(), { ...env, CLI_TOKEN: '' })
  for (const authorization of [undefined, 'Bearer ', 'Bearer x']) {
    const response = await service.fetch(
      new Request('http://localhost/cli/dev/seed-credentials', {
        method: 'POST',
        headers: authorization === undefined ? {} : { authorization },
        body: JSON.stringify({ openai: 'sk-do-not-echo' }),
      }),
    )
    expect(response.status).toBe(401)
    expect(await response.text()).toBe('Unauthorized')
  }
})

it('exports the same Durable Object and inherits the default service RPC', () => {
  expect(Agent).toBe(AgentObject)
  expect(CliService.prototype).toBeInstanceOf(AgentService)
  expect(Object.getPrototypeOf(CliService.prototype)).toBe(AgentService.prototype)
})
