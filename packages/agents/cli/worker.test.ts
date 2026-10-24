/**
 * The development Worker serves the CLI adapter in place of the service's HTTP refusal.
 *
 * @module
 */
import { createExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { expect, it } from 'vitest'
import { AgentObject } from '../src/agent-object.ts'
import { ManagementService as Service } from '../src/management/service/index.ts'
import CliService, { Agent, ManagementService } from './worker.ts'

it('answers HTTP through the token-checked CLI adapter', async () => {
  // Outside development the Worker's token is empty, so the adapter admits no request.
  const service = new CliService(createExecutionContext(), { ...env, CLI_TOKEN: '' })

  const response = await service.fetch(new Request('http://localhost/cli/seed', { method: 'POST' }))

  expect(response.status).toBe(401)
})

it('exports the same Durable Object and management service as the production Worker', () => {
  expect(Agent).toBe(AgentObject)
  expect(ManagementService).toBe(Service)
})
