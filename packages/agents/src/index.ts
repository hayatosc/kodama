import { WorkerEntrypoint } from 'cloudflare:workers'
import type { AgentEnv } from './env.ts'
import type {
  AgentSnapshotResponse,
  AgentConfig,
  SendMessageRequest,
  SendMessageResponse,
  SubmissionResponse,
} from './protocol.ts'
import { validateId } from './validation.ts'

export { Agent } from './agent.ts'

/** Service-binding RPC entrypoint for the UI server and other trusted Workers. */
export default class AgentService extends WorkerEntrypoint<AgentEnv> {
  override async fetch(_request: Request): Promise<Response> {
    return new Response('Use a Cloudflare RPC service binding.', { status: 404 })
  }

  async getConfig(agentId: string): Promise<AgentConfig> {
    validateId(agentId, 'agentId', 64)
    return this.env.AGENTS.getByName(agentId).getConfig()
  }

  async subscribe(agentId: string): Promise<ReadableStream<Uint8Array>> {
    validateId(agentId, 'agentId', 64)
    return this.env.AGENTS.getByName(agentId).subscribe()
  }

  async send(agentId: string, message: SendMessageRequest): Promise<ReadableStream<Uint8Array>> {
    validateId(agentId, 'agentId', 64)
    return this.env.AGENTS.getByName(agentId).send(message)
  }

  async setConfig(agentId: string, config: AgentConfig): Promise<AgentConfig> {
    validateId(agentId, 'agentId', 64)
    return this.env.AGENTS.getByName(agentId).setConfig(config)
  }

  async cancel(agentId: string): Promise<void> {
    validateId(agentId, 'agentId', 64)
    return this.env.AGENTS.getByName(agentId).cancel()
  }

  async sendMessage(agentId: string, message: SendMessageRequest): Promise<SendMessageResponse> {
    validateId(agentId, 'agentId', 64)
    const submissionId = await this.env.AGENTS.getByName(agentId).sendMessage(message)
    return { agentId, requestId: message.requestId, submissionId }
  }

  async snapshot(agentId: string): Promise<AgentSnapshotResponse> {
    validateId(agentId, 'agentId', 64)
    using snapshot = await this.env.AGENTS.getByName(agentId).snapshot()
    return { agentId, snapshot }
  }

  async submission(agentId: string, requestId: string): Promise<SubmissionResponse | undefined> {
    validateId(agentId, 'agentId', 64)
    using submission = await this.env.AGENTS.getByName(agentId).submission(requestId)
    return submission === undefined ? undefined : { agentId, submission }
  }
}
