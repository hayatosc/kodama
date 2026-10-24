/**
 * The development Worker: the agent and management services plus the CLI's HTTP adapter.
 *
 * @module
 */
import AgentService from '../src/index.ts'
import { handleCli } from './handler.ts'

export { AgentObject as Agent } from '../src/agent-object.ts'
export { ManagementService } from '../src/management/service/index.ts'

/** The agent service, answering the CLI's HTTP requests. */
export default class CliService extends AgentService {
  override async fetch(request: Request): Promise<Response> {
    return handleCli(request, this.env.CLI_TOKEN, this, this.ctx.exports.ManagementService)
  }
}
