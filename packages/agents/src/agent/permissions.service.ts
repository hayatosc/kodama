/**
 * Tool permission classifier (`allow`, `ask`, `auto`, `deny`) and non-blocking deferred tool
 * execution wrapper. High-risk or `ask`-gated calls persist a pending approval and return a
 * non-error `{ status: 'deferred', approvalId }` payload so the agent stays responsive.
 *
 * @see docs/agents.md — Tool approvals
 * @module
 */
import type { JsonValue } from '@earendil-works/chord'
import type { TSchema } from '@earendil-works/pi-ai'
import type { ToolRegistration } from '@earendil-works/pi-durable'
import { sha256Hex } from '../lib/hash.ts'
import { consumeApprovedCall, createDeferredCall } from './local-db/deferred.repository.ts'
import type { LocalDb } from './local-db/local.ts'
import { recordNotification } from './notifications.service.ts'
import type { AppliedSettings } from './runtime/restrictions.ts'

/** Risk level assigned by the auto-mode classifier before tool execution. */
export type ToolRisk = 'low' | 'high'

/** Runtime dependencies required to enforce tool approval policies. */
export interface PermissionDeps {
  local: () => Promise<LocalDb>
  serialize: <T>(operation: () => Promise<T>) => Promise<T>
  settings: AppliedSettings
  onDeferred?: () => Promise<void>
  isReadOnlyMcp?: (toolName: string) => Promise<boolean> | boolean
  toolDigest?: (toolName: string) => Promise<string | undefined> | string | undefined
}

const LOW_RISK_TOOLS = new Set([
  'current_time',
  'web_search',
  'web_fetch',
  'list_contacts',
  'contact_status',
  'contact_result',
  'discover_agents',
  'list_scheduled_tasks',
  'list_artifacts',
  'read_artifact',
  'memory_search',
  'history_search',
  'remember',
  'skill_read',
  'task_read',
  'task_write',
  'send_outbox',
])

const HIGH_RISK_TOOLS = new Set([
  'execute_code',
  'contact_agent',
  'delete_artifact',
  'create_artifact',
  'schedule_task',
  'update_scheduled_task',
  'cancel_scheduled_task',
  'mcp_registration',
])

function normalizeForJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForJson)
  if (value !== null && typeof value === 'object') {
    const entries: [string, unknown][] = []
    for (const key of Object.keys(value).sort()) {
      const entry = Object.getOwnPropertyDescriptor(value, key)?.value
      if (entry !== undefined) entries.push([key, normalizeForJson(entry)])
    }
    return Object.fromEntries(entries)
  }
  return value
}

/** Deterministic canonical JSON string for matching a deferred request to a single-use approval. */
export function stableArgsJson(args: unknown): string {
  return JSON.stringify(normalizeForJson(args)) ?? 'null'
}

/**
 * Pure risk classifier for `toolPolicy: { [tool]: 'auto' }`:
 * - Read-only informational tools are `low` risk and execute automatically.
 * - Mutating, code-executing, peer-contacting, or non-read-only MCP tools are `high` risk and
 *   defer for explicit operator approval.
 */
export function classifyToolRisk(
  toolName: string,
  _args: unknown,
  isReadOnlyMcp?: boolean,
): ToolRisk {
  if (LOW_RISK_TOOLS.has(toolName)) return 'low'
  if (HIGH_RISK_TOOLS.has(toolName)) return 'high'
  if (toolName.startsWith('mcp_')) {
    return isReadOnlyMcp === true ? 'low' : 'high'
  }
  return 'high'
}

/** Wrap a tool registration so `'ask'` and high-risk `'auto'` calls defer instead of blocking. */
export function wrapToolWithPermissions<TParameters extends TSchema, TDetails extends JsonValue>(
  tool: ToolRegistration<TParameters, TDetails>,
  deps: PermissionDeps,
): ToolRegistration<TParameters, TDetails> {
  return {
    ...tool,
    execute: async (args, api, context) => {
      const applied = await deps.settings()
      const policy = applied?.toolPolicy?.[tool.name] ?? 'allow'
      if (policy === 'allow' || policy === 'deny') {
        return tool.execute(args, api, context)
      }
      const readOnlyMcp = deps.isReadOnlyMcp ? await deps.isReadOnlyMcp(tool.name) : undefined
      if (policy === 'auto' && classifyToolRisk(tool.name, args, readOnlyMcp) === 'low') {
        return tool.execute(args, api, context)
      }
      const reason =
        policy === 'ask'
          ? `Tool ${tool.name} requires operator approval before execution`
          : `Auto-mode policy deferred high-risk call to ${tool.name} for operator approval`
      const argumentsJson = stableArgsJson(args)
      const digest = (deps.toolDigest ? await deps.toolDigest(tool.name) : undefined) ?? null
      const sourceTask = `${String(api.taskId)}:${await sha256Hex(`${digest ?? ''}:${argumentsJson}`)}`
      const outcome = await deps.serialize(async () => {
        const local = await deps.local()
        const now = Date.now()
        const consumed = consumeApprovedCall(local, tool.name, argumentsJson, now, digest)
        if (consumed) return { kind: 'approved' as const }
        const row = createDeferredCall(
          local,
          {
            toolName: tool.name,
            toolDigest: digest,
            argumentsJson,
            reason,
            sourceTask,
          },
          now,
        )
        recordNotification(
          local,
          {
            source: 'approval',
            sourceId: row.approvalId,
            outcome: 'succeeded',
            summary: `Approval requested for ${tool.name}`,
            details: `${reason}\nArguments: ${argumentsJson.slice(0, 500)}`,
            artifactIds: [],
          },
          now,
        )
        return { kind: 'deferred' as const, row }
      })
      if (outcome.kind === 'approved') {
        return tool.execute(args, api, context)
      }
      await deps.onDeferred?.()
      return {
        output: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'deferred',
              approvalId: outcome.row.approvalId,
              toolName: tool.name,
              reason,
              message:
                'Tool execution deferred for non-blocking operator approval. Do not retry this tool call in this turn; inform the operator and continue any unrelated work.',
            }),
          },
        ],
      }
    },
  }
}

/** Apply {@link wrapToolWithPermissions} to every tool in an extension registration list. */
export function wrapToolsWithPermissions(
  tools: readonly ToolRegistration[],
  deps: PermissionDeps,
): ToolRegistration[] {
  return tools.map((tool) => wrapToolWithPermissions(tool, deps))
}
