/** Bind chat management to host-admitted conversation inputs, without a separate intake ledger. @module */
import { LiveDoc, ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import type { Harness } from '@earendil-works/pi-durable'
import type { AgentEnv } from '../env.ts'
import { managementDb } from '../control-plane/db.ts'
import { createAgentModels } from '../control-plane/models.ts'
import { requireMcpAgent, rememberMcpIntent } from '../control-plane/mcp-intents.ts'
import { chatMcp, readMcpChatStatus } from '../control-plane/workflows/mcp-chat.ts'
import { pushDesired } from '../control-plane/workflows/agents.ts'
import { parseMcpInstruction } from '../tools/mcp/registration.ts'
import type { McpRegistrationCall } from '../tools/mcp/registration.ts'
import { currentRunInputs, operatorInput } from './runtime/inputs.ts'

/** Legacy pi.user, peer, schedule, completion and mixed inputs never authorize management. */
export function createMcpRegistrationCall(
  env: AgentEnv,
  agentId: string,
  harness: () => Promise<Harness>,
  checkAllowed: () => void,
): McpRegistrationCall {
  return async (input, api, context) => {
    context.abortSignal?.throwIfAborted()
    if (api.conversationId !== ROOT_CONVERSATION_ID) throw new Error('mcp_operator_input_required')
    const runtime = await harness()
    const live = await runtime.snapshot(LiveDoc, ROOT_CONVERSATION_ID, context)
    const db = managementDb(env.MANAGEMENT_DB)
    if (input.operation === 'status') {
      checkAllowed()
      if (
        !live?.run ||
        ![...(live.tools ?? []), ...(live.nestedTools ?? [])].some(
          (tool) => tool.taskId === api.taskId && tool.status === 'running',
        )
      )
        throw new Error('mcp_execution_changed')
      return readMcpChatStatus(db, agentId, String(ROOT_CONVERSATION_ID), input)
    }
    const entries = await currentRunInputs(runtime, context)
    if (!live?.run || !entries?.length) throw new Error('mcp_operator_input_required')
    const inputs = entries.map((entry, index) => {
      const message = operatorInput(entry)
      const submissionId = live.run?.inputs[index]
      if (!message || submissionId === undefined) throw new Error('mcp_operator_input_required')
      return {
        evidence: {
          sourceAgentId: agentId,
          conversationId: String(ROOT_CONVERSATION_ID),
          entryId: entry.id,
          submissionId: String(submissionId),
          createdAt: message.createdAt,
        },
        instruction: parseMcpInstruction(message.content),
      }
    })
    const first = inputs[0]
    if (!first) throw new Error('mcp_operator_input_required')
    await requireMcpAgent(db, agentId)
    const call = {
      env,
      db,
      models: createAgentModels(),
      source: 'operator' as const,
      now: Date.now(),
    }
    const matching = inputs.filter((item) => item.instruction?.operation === input.operation)
    if ((input.operation === 'register' || input.operation === 'assign') && matching.length !== 1)
      throw new Error('mcp_explicit_instruction_required')
    const matched = matching[0]
    const evidence = matched?.evidence ?? first.evidence
    const intent = matched?.instruction
      ? await rememberMcpIntent(db, evidence, matched.instruction)
      : undefined
    const runId = live.run.taskId
    const inputIds = JSON.stringify(live.run.inputs)
    const result = await runtime.commit(async (tx) => {
      const current = await tx.doc(LiveDoc, ROOT_CONVERSATION_ID)
      if (
        current.run?.taskId !== runId ||
        JSON.stringify(current.run.inputs) !== inputIds ||
        ![...(current.tools ?? []), ...(current.nestedTools ?? [])].some(
          (tool) => tool.taskId === api.taskId && tool.status === 'running',
        )
      )
        throw new Error('mcp_execution_changed')
      context.abortSignal?.throwIfAborted()
      checkAllowed()
      await requireMcpAgent(db, agentId)
      return chatMcp(call, env.CREDENTIAL_KEK_V1, env.KODAMA_UI_ORIGIN, evidence, input, intent)
    }, context)
    // Never invoke this object's RPC while holding its harness mutation line.
    if (input.operation === 'assign' && input.agentId) await pushDesired(call, input.agentId)
    return result
  }
}
