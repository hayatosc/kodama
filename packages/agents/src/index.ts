import { WorkerEntrypoint } from 'cloudflare:workers'
import type { AgentEnv } from './env.ts'
import { memoryDb } from './memory/records.ts'
import { decideProposal, listProposals, proposalSummary } from './memory/proposals.ts'
import type {
  AgentSnapshotResponse,
  ProposalDecisionRequest,
  ProposalStatus,
  ProposalSummary,
  AgentConfig,
  SendMessageRequest,
  SendMessageResponse,
  SubmissionResponse,
} from './protocol.ts'
import { MEMORY_AGENT_NAME } from './memory/working.ts'
import {
  parseAgentId,
  parseInput,
  ProposalDecisionSchema,
  ProposalIdSchema,
  ProposalStatusSchema,
  SpaceSchema,
} from './validation.ts'

export { Agent } from './agent.ts'
export { MemoryAgent } from './memory/memory-agent.ts'

/** Service-binding RPC entrypoint for the UI server and other trusted Workers. */
export default class AgentService extends WorkerEntrypoint<AgentEnv> {
  override async fetch(_request: Request): Promise<Response> {
    return new Response('Use a Cloudflare RPC service binding.', { status: 404 })
  }

  /** The daily cron trigger: the memory agent consolidates what changed in the last day. */
  override async scheduled(controller: ScheduledController): Promise<void> {
    await this.env.MEMORY_AGENT.getByName(MEMORY_AGENT_NAME).consolidate(controller.scheduledTime)
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

  /** Proposals to a shared space; the UI server authenticates and authorizes the reviewer. */
  async listProposals(
    space: string,
    status: ProposalStatus = 'pending',
  ): Promise<ProposalSummary[]> {
    const rows = await listProposals(
      memoryDb(this.env.MEMORY_DB),
      parseInput(SpaceSchema, space),
      parseInput(ProposalStatusSchema, status),
    )
    return Promise.all(rows.map((row) => proposalSummary(this.env.ARCHIVE, row)))
  }

  /**
   * Accept or reject a pending proposal. A second decision changes nothing and returns the current
   * state. An accepted proposal is applied by the memory agent.
   */
  async decideProposal(id: string, request: ProposalDecisionRequest): Promise<ProposalSummary> {
    const decision = parseInput(ProposalDecisionSchema, request)
    const proposal = await decideProposal(memoryDb(this.env.MEMORY_DB), {
      id: parseInput(ProposalIdSchema, id),
      ...decision,
      now: Date.now(),
    })
    if (proposal === undefined) throw new TypeError(`No proposal ${id}`)
    if (proposal.status === 'accepted') {
      await this.env.MEMORY_AGENT.getByName(MEMORY_AGENT_NAME).enqueue({
        kind: 'apply_proposal',
        proposalId: proposal.id,
      })
    }
    return proposalSummary(this.env.ARCHIVE, proposal)
  }

  async submission(agentId: string, requestId: string): Promise<SubmissionResponse | undefined> {
    using submission = await this.#agent(agentId).submission(requestId)
    return submission === undefined ? undefined : { agentId, submission }
  }
}
