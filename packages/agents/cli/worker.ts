/**
 * The development Worker: the agent and management services plus the CLI's HTTP adapter.
 *
 * @module
 */
import AgentService from '../src/index.ts'
import { seedLocalCredentials } from '../src/credentials/bootstrap.ts'
import { handleCli } from './handler.ts'

export { AgentObject as Agent } from '../src/agent-object.ts'

/** The agent service, answering the CLI's HTTP requests. */
export default class CliService extends AgentService {
  override async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === '/cli/dev/seed-credentials') {
      if (
        !this.env.CLI_TOKEN ||
        request.headers.get('authorization') !== 'Bearer '.concat(this.env.CLI_TOKEN)
      )
        return new Response('Unauthorized', { status: 401 })
      if (request.method !== 'POST') return new Response('Use POST', { status: 405 })
      try {
        return Response.json(
          await seedLocalCredentials(this.env, request, (refs) => this.seed(refs)),
        )
      } catch {
        return Response.json(
          {
            error:
              'Credential bootstrap failed; check the development KEK and provider-to-key JSON',
          },
          { status: 400 },
        )
      }
    }
    return handleCli(request, this.env.CLI_TOKEN, this, this.ctx.exports.default)
  }
}
