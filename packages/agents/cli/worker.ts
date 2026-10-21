import AgentService from '../src/index.ts'
import { handleCli } from './handler.ts'

export { Agent } from '../src/agent/agent.ts'

export default class CliService extends AgentService {
  override async fetch(request: Request): Promise<Response> {
    return handleCli(request, this.env.CLI_TOKEN, this)
  }
}
