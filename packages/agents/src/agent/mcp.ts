/** Working-agent MCP registry construction and guarded, bounded execution. @module */
import { defineExtension, LiveDoc, ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import type { Harness } from '@earendil-works/pi-durable'
import type { ManagementDb } from '../control-plane/db.ts'
import type { AgentSettings } from '../protocol.ts'
import { markMcpStale, mcpCatalogNotices } from '../control-plane/mcp-notifications.ts'
import { recordNotification } from './local-db/notifications.ts'
import { guardMcpSelection, mcpDefinition } from '../control-plane/mcp.ts'
import { authorizeMcp, markMcpAuthenticationFailure } from '../credentials/mcp-refresh.ts'
import { createMcpTool, validateMcpResult } from '../tools/mcp/tool.ts'
import type { McpCall } from '../tools/mcp/tool.ts'
import { closeMcpSession, mcpRequest, openMcpSession } from '../tools/mcp/transport.ts'
import { currentRunInputs } from './runtime/inputs.ts'
import { ownerReplyReceipt } from './local-db/owner-intake.ts'
import { beginMcpCall, finishMcpCall, pruneMcpCalls, mcpRecoveryEpoch } from './local-db/mcp.ts'
import type { LocalDb } from './local-db/local.ts'
import { assertAllowed } from './runtime/restrictions.ts'
import type { AppliedSettings, Refusal } from './runtime/restrictions.ts'

/** Build an immutable extension from the applied version, without contacting any MCP server. */
export async function mcpExtension(
  db: ManagementDb,
  settings: AgentSettings | undefined,
  call: McpCall,
) {
  const tools = await Promise.all(
    (settings?.mcp ?? [])
      .filter((tool) => settings?.tools.includes(tool.modelName))
      .map(async (selected) =>
        createMcpTool(selected, await mcpDefinition(db, selected.digest), call),
      ),
  )
  return defineExtension({ name: 'kodama-mcp', tools })
}

/** One closure per object holds its two-call concurrency bound, not credentials or persistent sessions. */
export function createMcpCall(
  db: ManagementDb,
  kek: string,
  agentId: string,
  local: Promise<LocalDb>,
  harness: () => Promise<Harness>,
  settings: AppliedSettings,
  refusal: Refusal,
): McpCall {
  let active = 0
  return async (selected, args, api, context) => {
    const store = await local
    if (active >= 2) throw new Error('mcp_concurrency_limit')
    active++
    let started = false
    const callId = String(api.taskId)
    try {
      const live = await (await harness()).snapshot(LiveDoc, ROOT_CONVERSATION_ID, context)
      if (!live?.run) throw new Error('mcp_execution_changed')
      const inputs = await currentRunInputs(await harness(), context)
      let ownerRequestId: string | undefined
      if (inputs?.length && inputs.every((entry) => entry.kind === 'kodama.owner-message')) {
        for (const entry of inputs) {
          const data: unknown = entry.data
          if (
            data &&
            typeof data === 'object' &&
            'requestId' in data &&
            typeof data.requestId === 'string'
          ) {
            const receipt = ownerReplyReceipt(store, data.requestId)
            if (
              receipt?.state === 'accepted' &&
              receipt.submissionId &&
              live.run.inputs.some((id) => id === receipt.submissionId)
            ) {
              ownerRequestId = data.requestId
            }
          }
        }
      }
      const signal = AbortSignal.any([
        ...(context.abortSignal ? [context.abortSignal] : []),
        AbortSignal.timeout(30_000),
      ])
      const check = async () => {
        assertAllowed(refusal)
        signal.throwIfAborted()
        const applied = await settings()
        const pinned = applied?.mcp?.find((tool) => tool.toolId === selected.toolId)
        if (
          !pinned ||
          pinned.digest !== selected.digest ||
          pinned.credentialId !== selected.credentialId ||
          !applied?.tools.includes(selected.modelName) ||
          applied.toolPolicy?.[selected.modelName] === 'deny'
        )
          throw new Error('mcp_tool_disabled')
        return guardMcpSelection(db, agentId, selected)
      }
      const target = await check()
      const runId = mcpRecoveryEpoch(store, ownerRequestId)
      const authorize = async (sendSignal: AbortSignal) => {
        const current = await check()
        if (current.endpoint !== target.endpoint) throw new Error('mcp_auth_binding_changed')
        const token = await authorizeMcp(
          db,
          kek,
          selected.serverId,
          selected.credentialId,
          target.endpoint,
          sendSignal,
          agentId,
        )
        // A refresh can yield; check again immediately before transport sends the token.
        await check()
        return token
      }
      pruneMcpCalls(store, runId)
      beginMcpCall(store, callId, runId, selected.toolId)
      started = true
      const session = await openMcpSession(target.endpoint, authorize, signal)
      try {
        const result = await mcpRequest(
          session,
          'tools/call',
          { name: target.remoteName, arguments: args },
          authorize,
          signal,
        )
        const checked = validateMcpResult(await mcpDefinition(db, selected.digest), result)
        finishMcpCall(store, callId, checked.isError === true ? 'mcp_remote_tool_error' : undefined)
        return result
      } finally {
        if (session.stale) {
          await markMcpStale(db, selected.serverId, selected.serverRevision)
          for (const notice of await mcpCatalogNotices(db, agentId, selected.serverId))
            recordNotification(store, notice, Date.now())
        }
        await closeMcpSession(session, authorize)
      }
    } catch (error) {
      const failure =
        error instanceof Error && /^mcp_[a-z_]+$/u.test(error.message)
          ? error.message
          : 'mcp_interrupted'
      if (started) {
        finishMcpCall(store, callId, failure)
        await markMcpAuthenticationFailure(db, selected.serverId, selected.credentialId, failure)
      }
      for (const notice of await mcpCatalogNotices(db, agentId, selected.serverId))
        recordNotification(store, notice, Date.now())
      throw new Error(failure)
    } finally {
      active--
    }
  }
}
