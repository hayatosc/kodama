import type { SubmissionRecord } from '@earendil-works/pi-durable'
import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import type { AgentEvent } from '@earendil-works/pi-durable'

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

export interface SendMessageResponse {
  agentId: string
  requestId: string
  submissionId: number
}

export interface AgentSnapshotResponse {
  agentId: string
  snapshot: AgentSnapshot
}

export interface SubmissionResponse {
  agentId: string
  submission: SubmissionStatus
}

export interface AgentMessage {
  entryId: number
  role: 'user' | 'assistant'
  text: string
}

export interface AgentSnapshot {
  messages: AgentMessage[]
  busy: boolean
}

/**
 * `unanswered` carries Pi's reason, such as `model_error`, and its detail as text, such as the provider
 * error message. Non-string details are JSON-encoded.
 */
export type SubmissionStatus = { id: number; requestId: string } & (
  | { status: Exclude<SubmissionRecord['status'], 'unanswered'> }
  | { status: 'unanswered'; reason: string; detail?: string }
)

/** A change to shared memory, reviewed as written (docs/design/long-term-memory.md, Review). */
export type ProposalPayload =
  | {
      type: 'record'
      kind: 'fact' | 'instruction' | 'event' | 'task'
      content: string
      importance?: number
      required?: boolean
      /** The shared record it replaces. */
      replaces?: string
    }
  | { type: 'skill'; name: string; files: { path: string; sha256: string }[]; remove: string[] }

export type ProposalStatus = 'pending' | 'accepted' | 'applied' | 'rejected' | 'conflict'

export interface ProposalSummary {
  id: string
  space: string
  target: 'record' | 'skill'
  targetKey: string
  baseRevision: number | null
  payload: ProposalPayload
  /** The text of a skill proposal's files, for the reviewer. */
  skillFiles?: { path: string; content: string }[]
  sourceIds: string[]
  status: ProposalStatus
  proposedAt: number
  decidedAt: number | null
  decidedBy: string | null
  reason: string | null
  appliedAt: number | null
}

/** `decidedBy` names the reviewer the UI server authenticated. */
export interface ProposalDecisionRequest {
  decision: 'accept' | 'reject'
  reason: string
  decidedBy: string
}
