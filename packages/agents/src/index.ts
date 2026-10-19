import { WorkerEntrypoint } from 'cloudflare:workers'
import type { AgentEnv } from './env.ts'
import type {
  AgentSnapshotResponse,
  AgentConfig,
  SendMessageRequest,
  SendMessageResponse,
  SubmissionResponse,
} from './protocol.ts'
import { parseAgentId } from './validation.ts'

export { Agent } from './agent.ts'

/** Service-binding RPC entrypoint for the UI server and other trusted Workers. */
export default class AgentService extends WorkerEntrypoint<AgentEnv> {
  override async fetch(_request: Request): Promise<Response> {
    return new Response('Use a Cloudflare RPC service binding.', { status: 404 })
  }

  /** Every method resolves the agent through here so IDs are validated at the RPC boundary. */
  #agent(agentId: string) {
    return this.env.AGENTS.getByName(parseAgentId(agentId))
  }

  async getConfig(agentId: string): Promise<AgentConfig> {
    return this.#agent(agentId).getConfig()
  }

  async subscribe(agentId: string): Promise<ReadableStream<Uint8Array>> {
    return this.#agent(agentId).subscribe()
  }

  async send(agentId: string, message: SendMessageRequest): Promise<ReadableStream<Uint8Array>> {
    return this.#agent(agentId).send(message)
  }

  async setConfig(agentId: string, config: AgentConfig): Promise<AgentConfig> {
    return this.#agent(agentId).setConfig(config)
  }

  async cancel(agentId: string): Promise<void> {
    return this.#agent(agentId).cancel()
  }

  async sendMessage(agentId: string, message: SendMessageRequest): Promise<SendMessageResponse> {
    const submissionId = await this.#agent(agentId).sendMessage(message)
    return { agentId, requestId: message.requestId, submissionId }
  }

  async snapshot(agentId: string): Promise<AgentSnapshotResponse> {
    using snapshot = await this.#agent(agentId).snapshot()
    return { agentId, snapshot }
  }

  async submission(agentId: string, requestId: string): Promise<SubmissionResponse | undefined> {
    using submission = await this.#agent(agentId).submission(requestId)
    return submission === undefined ? undefined : { agentId, submission }
  }
}
