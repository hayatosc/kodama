/** Shared, transport-safe contracts for artifacts, durable contacts, and notifications.
 * @see docs/extensions.md — Shared contracts
 * @module
 */

/** Maximum bytes in one artifact, independent of its media type. */
export const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024
/** Maximum files returned by one isolated code execution. */
export const MAX_CODE_OUTPUT_FILES = 4
/** Default retention after completion; pending work must not expire as a successful result. */
export const EXTENSION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
/** Maximum UTF-8 bytes retained in a contact answer; truncation must be explicit. */
export const MAX_CONTACT_RESULT_BYTES = 64 * 1024
/** Maximum UTF-8 bytes in a notification summary, not a substitute for its result. */
export const MAX_NOTIFICATION_SUMMARY_BYTES = 2048

/** A terminal result, distinct from durable admission or a pending execution. */
export type CompletionOutcome = 'succeeded' | 'failed' | 'cancelled' | 'unanswered'

/** A result reference is scoped to the owning object and never grants access itself. */
export interface CompletionReference {
  source: 'contact' | 'schedule'
  sourceId: string
}

/** Server-derived completion input; never accept this as model-authored provenance. */
export interface CompletionNotice extends CompletionReference {
  outcome: CompletionOutcome
  summary: string
  artifactIds: string[]
}

/** Public metadata only: internal R2 keys and upload state must not cross the RPC boundary. */
export interface ArtifactMetadata {
  artifactId: string
  filename: string
  mediaType: string
  size: number
  createdAt: number
  expiresAt: number
}

/** Arbitrary binary upload through an authenticated service binding, not a public URL. */
export interface ArtifactUpload {
  filename: string
  mediaType: string
  bytes: Uint8Array
}

/** Retained answer text explicitly describes loss rather than pretending to be the full answer. */
export interface ContactResult {
  outcome: CompletionOutcome
  text: string
  truncated: boolean
  artifactIds: string[]
}

/** Stable notification sequence and agent-wide acknowledgement state. */
export interface AgentNotification extends CompletionNotice {
  seq: number
  createdAt: number
  expiresAt: number
  readAt: number | null
}
