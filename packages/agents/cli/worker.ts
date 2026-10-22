/**
 * The development Worker: the agent service plus the CLI's HTTP adapter.
 *
 * @module
 */
import AgentService from '../src/index.ts'
import { handleCli } from './handler.ts'

export { Agent } from '../src/agent/agent.ts'

/** The agent service, answering the CLI's HTTP requests. */
export default class CliService extends AgentService {
  override async fetch(request: Request): Promise<Response> {
    return handleCli(request, this.env.CLI_TOKEN, this)
  }
}
