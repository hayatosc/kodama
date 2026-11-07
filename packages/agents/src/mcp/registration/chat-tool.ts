/** Static registration adapter and deliberately limited operator command syntax. @module */
import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-durable'
import type { ToolExecutionApi } from '@earendil-works/pi-durable'
import type { Context } from '@earendil-works/chord/context'
import { isUuid } from '../../lib/uuid.ts'
import { mcpEndpoint } from '../connection/transport.ts'

/** Model arguments contain no identity, approval, bearer token or OAuth material. */
export interface McpRegistrationInput {
  operation: 'register' | 'status' | 'connect' | 'discover' | 'assign'
  name?: string
  endpoint?: string
  serverId?: string
  proposalId?: string
  toolIds?: string[]
  agentId?: string
  page?: number
}
/** Host-owned operation checks authenticated provenance and durable explicit intent. */
export type McpRegistrationCall = (
  input: McpRegistrationInput,
  api: ToolExecutionApi,
  context: Context,
) => Promise<unknown>
/** Instructions recognized from a complete raw operator message, never from quoted substrings. */
export type McpInstruction =
  | { operation: 'register'; name: string; endpoint?: string }
  | { operation: 'assign'; proposalId: string; toolIds: string[]; agentId: string }

/** Strict whole-message syntax avoids treating prose, quotes or external URLs as authority. */
export function parseMcpInstruction(text: string): McpInstruction | undefined {
  const register = /^\/mcp register ([^\s"'<>`]{1,128})(?: (https:\/\/[^\s]+))?$/u.exec(text)
  if (register?.[1]) {
    try {
      return {
        operation: 'register',
        name: register[1],
        ...(register[2] ? { endpoint: mcpEndpoint(register[2]) } : {}),
      }
    } catch {
      return undefined
    }
  }
  const assign = /^\/mcp assign ([a-f0-9-]+) ([a-f0-9,-]+) ([a-f0-9-]+)$/u.exec(text)
  if (!assign?.[1] || !assign[2] || !assign[3]) return undefined
  const toolIds = assign[2].split(',').sort()
  if (
    !isUuid(assign[1]) ||
    !isUuid(assign[3]) ||
    !toolIds.length ||
    toolIds.length > 100 ||
    toolIds.some((id) => !isUuid(id)) ||
    new Set(toolIds).size !== toolIds.length
  )
    return undefined
  return { operation: 'assign', proposalId: assign[1], toolIds, agentId: assign[3] }
}

/** No remote MCP server can supply or replace this built-in tool. */
export function createMcpRegistrationTool(call?: McpRegistrationCall) {
  return defineTool({
    name: 'mcp_registration',
    replay: 'unsafe',
    description:
      'Manage MCP only on explicit authenticated direct-operator instruction. Ask for `/mcp register NAME HTTPS_ENDPOINT` (or an existing unique NAME). Never search or guess endpoints. Show the host selection proposal and require `/mcp assign PROPOSAL_ID TOOL_ID,TOOL_ID AGENT_UUID`; this confirms selected tools for read-only use. An OK or OAuth consent is not assignment. Never ask for tokens in chat.',
    parameters: Type.Object(
      {
        operation: Type.Union(
          ['register', 'status', 'connect', 'discover', 'assign'].map((operation) =>
            Type.Literal(operation),
          ),
        ),
        name: Type.Optional(Type.String({ maxLength: 128 })),
        endpoint: Type.Optional(Type.String({ maxLength: 2048 })),
        serverId: Type.Optional(Type.String()),
        proposalId: Type.Optional(Type.String()),
        toolIds: Type.Optional(Type.Array(Type.String(), { maxItems: 100 })),
        agentId: Type.Optional(Type.String()),
        page: Type.Optional(Type.Integer({ minimum: 0, maximum: 9 })),
      },
      { additionalProperties: false },
    ),
    execute: async (input, api, context) => {
      if (!call) throw new Error('mcp_registration_unavailable')
      if (
        input.operation !== 'register' &&
        input.operation !== 'status' &&
        input.operation !== 'connect' &&
        input.operation !== 'discover' &&
        input.operation !== 'assign'
      )
        throw new Error('mcp_operation_invalid')
      return {
        output: [
          {
            type: 'text',
            text: JSON.stringify(
              await call({ ...input, operation: input.operation }, api, context),
            ),
          },
        ],
      }
    },
  })
}
