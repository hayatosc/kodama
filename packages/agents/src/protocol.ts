/**
 * Transport types of the agents RPC. Consumers should import them with `import type`.
 *
 * @see docs/agents.md — RPC contract
 *
 * @module
 */
import type { SubmissionRecord } from '@earendil-works/pi-durable'
import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import type { AgentEvent } from '@earendil-works/pi-durable'

/**
 * An event of an `AgentService.send` stream: Pi's events, preceded by `accepted` once the
 * message is admitted.
 */
export type AgentSendEvent =
  | AgentEvent
  | { type: 'accepted'; requestId: string; submissionId: number }

/** JSON payload of each named SSE event. Pi may emit a replacement snapshot after overflow. */
export type { AgentEvent } from '@earendil-works/pi-durable'

/** Complete, non-secret configuration. Updates replace all fields for one agent. */
export interface AgentConfig {
  model: { provider: string; modelId: string }
  systemPrompt: string
  thinkingLevel: ModelThinkingLevel
  tools: string[]
  /** Shared memory spaces the agent reads, earliest first; defaults to `["global"]`. */
  sharedSpaces: string[]
}

/** Reuse requestId when retrying the same message; a new turn needs a new ID. */
export interface SendMessageRequest {
  requestId: string
  content: string
  /** Defaults to followUp; steer joins the current run at the next tool-round boundary. */
  whenBusy?: 'followUp' | 'steer'
}

/** The acknowledgement that a message was durably admitted. */
export interface SendMessageResponse {
  agentId: string
  requestId: string
  submissionId: number
}

/** A snapshot of one agent, with its ID. */
export interface AgentSnapshotResponse {
  agentId: string
  snapshot: AgentSnapshot
}

/** The status of one submission, with the agent's ID. */
export interface SubmissionResponse {
  agentId: string
  submission: SubmissionStatus
}

/** One committed user or assistant message of the root conversation. */
export interface AgentMessage {
  entryId: number
  role: 'user' | 'assistant'
  text: string
}

/** Committed messages of the root conversation, and whether the agent is busy. */
export interface AgentSnapshot {
  messages: AgentMessage[]
  busy: boolean
}

/**
 * The status of one submission.
 *
 * @remarks
 * `unanswered` carries Pi's reason, such as `model_error`, and its detail as text, such as the
 * provider's error message. Non-string details are JSON-encoded.
 */
export type SubmissionStatus = { id: number; requestId: string } & (
  | { status: Exclude<SubmissionRecord['status'], 'unanswered'> }
  | { status: 'unanswered'; reason: string; detail?: string }
)
