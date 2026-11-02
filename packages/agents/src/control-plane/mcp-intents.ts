/** Host-only management intent persistence and atomic single-use consumption. @module */
import { and, eq, exists, gt, isNull } from 'drizzle-orm'
import { agents, principals, mcpCommits, mcpIntents } from '../../drizzle/management/schema.ts'
import type { ManagementDb } from './db.ts'
import type { McpInstruction } from '../tools/mcp/registration.ts'

/** Trusted transport evidence. This type is never parsed from RPC or tool input. */
export interface McpEvidence {
  principalId: string
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

/** Chat authority always belongs to the current working agent's enabled owner. */
export async function mcpChatPrincipal(db: ManagementDb, principalId: string, agentId: string) {
  const row = await db
    .select({ principal: principals })
    .from(principals)
    .innerJoin(agents, eq(agents.ownerId, principals.principalId))
    .where(
      and(
        eq(principals.principalId, principalId),
        isNull(principals.disabledAt),
        eq(agents.agentId, agentId),
        eq(agents.kind, 'working'),
        eq(agents.status, 'active'),
      ),
    )
    .get()
  if (!row) throw new Error('mcp_owner_required')
  return row.principal
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
  await db
    .insert(mcpIntents)
    .values({ ...evidence, intentId, expiresAt, instructionJson })
    .onConflictDoNothing()
  const stored = await db.select().from(mcpIntents).where(eq(mcpIntents.intentId, intentId)).get()
  if (
    !stored ||
    stored.consumedAt !== null ||
    stored.instructionJson !== instructionJson ||
    stored.principalId !== evidence.principalId ||
    stored.expiresAt !== expiresAt
  )
    throw new Error('mcp_intent_unavailable')
  return { ...evidence, intentId, instruction, expiresAt }
}

/** Both statements belong to the mutation batch; a failed fence rolls back every write. */
export function consumeMcpIntent(db: ManagementDb, intent: McpIntent) {
  const now = Date.now()
  return [
    db.insert(mcpCommits).values({
      operationId: `intent:${intent.intentId}`,
      createdAt: now,
      authorized: exists(
        db
          .select()
          .from(mcpIntents)
          .where(
            and(
              eq(mcpIntents.intentId, intent.intentId),
              eq(mcpIntents.principalId, intent.principalId),
              eq(mcpIntents.instructionJson, JSON.stringify(intent.instruction)),
              gt(mcpIntents.expiresAt, now),
              isNull(mcpIntents.consumedAt),
            ),
          ),
      ),
    }),
    db.update(mcpIntents).set({ consumedAt: now }).where(eq(mcpIntents.intentId, intent.intentId)),
  ] as const
}

/** Audit only references, not the owner's message text or any credentials. */
export function mcpIntentAudit(intent: McpIntent) {
  return {
    origin: 'chat',
    principalId: intent.principalId,
    sourceAgentId: intent.sourceAgentId,
    conversationId: intent.conversationId,
    entryId: intent.entryId,
    submissionId: intent.submissionId,
    operationId: intent.intentId,
  }
}
