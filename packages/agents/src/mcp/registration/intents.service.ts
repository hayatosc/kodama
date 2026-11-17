/** Host-only management intent persistence and atomic single-use consumption service. @module */
import type { ManagementDb } from '../../control-plane/db.ts'
import { findActiveWorkingAgent } from './catalog.repository.ts'
import type { McpInstruction } from './chat-tool.ts'
import {
  commitMcpIntentStatement,
  consumeMcpIntentStatement,
  findMcpIntent,
  insertMcpIntentIgnore,
} from './requests.repository.ts'

/** Trusted transport evidence. This type is never parsed from RPC or tool input. */
export interface McpEvidence {
  sourceAgentId: string
  conversationId: string
  entryId: number
  submissionId: string
  createdAt: number
}

/** One host-recognized instruction bound to its immutable input receipt. */
export interface McpIntent extends McpEvidence {
  intentId: string
  instruction: McpInstruction
  expiresAt: number
}

/** Chat management is available only on an active working agent, never a dedicated agent. */
export async function requireMcpAgent(db: ManagementDb, agentId: string) {
  const row = await findActiveWorkingAgent(db, agentId)
  if (!row) throw new Error('mcp_agent_unavailable')
  return row
}

/** Re-observation cannot renew an old instruction or change its normalized meaning. */
export async function rememberMcpIntent(
  db: ManagementDb,
  evidence: McpEvidence,
  instruction: McpInstruction,
): Promise<McpIntent> {
  const intentId = `${evidence.sourceAgentId}:${evidence.entryId}`
  const expiresAt = evidence.createdAt + 600_000
  if (expiresAt <= Date.now()) throw new Error('mcp_intent_expired')
  const instructionJson = JSON.stringify(instruction)
  await insertMcpIntentIgnore(db, { ...evidence, intentId, expiresAt, instructionJson })
  const stored = await findMcpIntent(db, intentId)
  if (
    !stored ||
    stored.consumedAt !== null ||
    stored.instructionJson !== instructionJson ||
    stored.sourceAgentId !== evidence.sourceAgentId ||
    stored.conversationId !== evidence.conversationId ||
    stored.submissionId !== evidence.submissionId ||
    stored.expiresAt !== expiresAt
  )
    throw new Error('mcp_intent_unavailable')
  return { ...evidence, intentId, instruction, expiresAt }
}

/** Both statements belong to the mutation batch; a failed fence rolls back every write. */
export function consumeMcpIntent(
  db: ManagementDb,
  intent: McpIntent,
): readonly [D1PreparedStatement, D1PreparedStatement] {
  const now = Date.now()
  return [
    commitMcpIntentStatement(db, {
      operationId: `intent:${intent.intentId}`,
      intentId: intent.intentId,
      sourceAgentId: intent.sourceAgentId,
      conversationId: intent.conversationId,
      submissionId: intent.submissionId,
      instructionJson: JSON.stringify(intent.instruction),
      now,
      createdAt: now,
    }),
    consumeMcpIntentStatement(db, intent.intentId, now),
  ] as const
}

/** Audit only references, not the operator's message text or any credentials. */
export function mcpIntentAudit(intent: McpIntent) {
  return {
    origin: 'chat',
    sourceAgentId: intent.sourceAgentId,
    conversationId: intent.conversationId,
    entryId: intent.entryId,
    submissionId: intent.submissionId,
    operationId: intent.intentId,
  }
}
