/** Owner-only Web UI transport contracts; identities are supplied by the trusted RPC caller.
 * @module
 */

/** The browser message identity is stable across transport retries; sequence is agent-wide. */
export interface OwnerReply {
  requestId: string
  externalMessageId: string
  sequence: number
  deliveryId?: string
  action: 'followUp' | 'steer' | 'cancel'
  content?: string
}

/** Host-created entry provenance, never parsed from model arguments or message content. */
export interface OwnerProvenance {
  principalId: string
  conversationId: string
  requestId: string
  externalMessageId: string
  sequence: number
}

/** Acceptance into Pi or an uncertain cancellation, not completion of the model run. */
export interface OwnerReplyResult {
  requestId: string
  submissionId: number | null
  state: 'accepted' | 'unknown'
}

/** UI Worker receipt only; accepted does not imply browser display or inbox read. */
export interface OwnerDelivery {
  id: string
  source: 'submission' | 'notification'
  sourceId: string
  state: 'accepted' | 'failed' | 'unknown'
  createdAt: number
  updatedAt: number
}

/** A projection of existing execution or delivery state, not an independent task state. */
export interface AttentionItem {
  source: 'execution' | 'contact' | 'delivery'
  id: string
  reason: string
  lastProgressAt: number | null
  actions: 'cancel'[]
}
