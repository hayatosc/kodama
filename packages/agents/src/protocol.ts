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

/** The part of a configuration version that Pi and the memory copy use. */
export interface AgentConfig {
  model: { provider: string; modelId: string }
  systemPrompt: string
  thinkingLevel: ModelThinkingLevel
  tools: string[]
  /** Shared memory spaces the agent reads, earliest first; defaults to `["global"]`. */
  sharedSpaces: string[]
}

/** What the agent does with its long-term memory. */
export interface MemoryPolicy {
  /** Hand new entries to the memory agent after an idle period. */
  extract: boolean
  /** Offer the `remember` tool. */
  remember: boolean
}

/** One explicit credential per Pi provider, with no alternate credential resolution. */
export interface CredentialRefs {
  /** The credential each provider uses. */
  primary: Record<string, string>
}

/** One immutable configuration version of an agent. */
export interface AgentSettings extends AgentConfig {
  /** The shape of this object; 1 is the only one. */
  schemaVersion: 1
  description?: string
  labels?: string[]
  memoryPolicy: MemoryPolicy
  credentials?: CredentialRefs
  /** Per registered tool; a tool missing here is allowed. */
  toolPolicy?: Record<string, 'allow' | 'deny'>
}

/** A bounded day-aligned usage read, charged to the optional agent UUID. */
export interface UsageQuery {
  agentId?: string
  from: string
  to: string
  groupBy: 'day' | 'agent' | 'credential' | 'model'
  cursor?: string
  limit?: number
}

/** An exclusive descending sequence cursor over retained management audit rows. */
export interface AuditQuery {
  targetId?: string
  before?: number
  limit?: number
}

/** Who calls the management methods of `AgentService`, as the calling Worker authenticated them. */
export interface ManagementActor {
  kind: 'user' | 'service' | 'agent'
  /** The Access email, service token ID, or agent ID; resolved to a principal. */
  externalId: string
}

/** Lifecycle states of an agent. */
export type AgentStatus =
  | 'provisioning'
  | 'active'
  | 'pausing'
  | 'paused'
  | 'archived'
  | 'deleting'
  | 'deleted'

/** One registry row as `AgentService` returns it. */
export interface AgentSummary {
  agentId: string
  kind: 'working' | 'dedicated'
  displayName: string
  slug?: string
  status: AgentStatus
  /** The version requested in the registry. */
  desiredVersion: number
  /** The version the agent's object has fully applied. */
  appliedVersion: number
  /** Whether the desired version is not applied yet. */
  pending: boolean
  createdAt: number
  updatedAt: number
}

/** Create a working agent; the server assigns its ID. Reusing `requestId` returns the first. */
export interface CreateAgentRequest {
  requestId: string
  displayName: string
  slug?: string
  /** Explicit initial references, overriding the references in settings when provided. */
  credentials?: CredentialRefs
  /** Version 1; the current defaults when left out. */
  settings?: AgentSettings
}

/** Change the display name or slug; `slug: null` removes it. */
export interface RenameAgentRequest {
  displayName?: string
  slug?: string | null
}

/** Write `settings` as version `expectedVersion + 1`. Reusing `requestId` returns the first. */
export interface UpdateConfigRequest {
  requestId: string
  settings: AgentSettings
  expectedVersion: number
  comment?: string
}

/** Write the settings of `toVersion` as version `expectedVersion + 1`. */
export interface RollbackConfigRequest {
  requestId: string
  toVersion: number
  expectedVersion: number
  comment?: string
}

/** A stored configuration version. */
export interface ConfigVersion {
  version: number
  settings: AgentSettings
  /** The principal that wrote it; missing for the system (the seed). */
  authorId?: string
  comment?: string
  createdAt: number
}

/** What an agent's object did with a pushed version. */
export interface ApplyResult {
  /** `pending` waits for idle; `stale` means this or a newer version was applied already. */
  state: 'applied' | 'pending' | 'stale' | 'failed'
  /** The version the object has applied after the call. */
  appliedVersion: number
}

/** The result of writing a version. */
export interface ConfigWriteResult {
  version: number
  apply: ApplyResult
}

/** What the seed made sure exists. */
export interface SeedResult {
  installId: string
  memoryAgentId: string
}

/** Reuse requestId when retrying the same message; a new turn needs a new ID. */
export interface SendMessageRequest {
  requestId: string
  content: string
  /** Defaults to followUp; steer joins the current run at the next tool-round boundary. */
  whenBusy?: 'followUp' | 'steer'
}

/** Internal DO-to-DO provenance; set by sendTo, never inferred from message text. */
export interface AgentOrigin {
  senderAgentId: string
  hop: number
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
  | { status: Exclude<SubmissionRecord['status'], 'unanswered' | 'done'> }
  | { status: 'done'; answerEntryId?: number }
  | { status: 'unanswered'; reason: string; detail?: string }
)
