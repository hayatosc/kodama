/** Bounded Streamable HTTP sessions. No request, including reads, is implicitly replayed.
 * @module
 */
import { normalizeUrl } from '../web/url.ts'
import { array, decodeUtf8, parseJson, readBody, record, sseData } from '../web/stream.ts'

/** The only negotiated transport revision supported by this client. */
export const MCP_PROTOCOL = '2025-11-25'
/** Hard transfer limit, also applied cumulatively to discovery pages. */
export const MCP_MAX_BYTES = 1_048_576

/** Normalize an explicitly supplied endpoint without accepting secrets or alternate transports. */
export function mcpEndpoint(input: string): string {
  const url = new URL(normalizeUrl(input))
  if (url.protocol !== 'https:' || url.search || new URL(input).hash)
    throw new TypeError('mcp_endpoint_invalid')
  return url.href
}

/** Ephemeral session state, never persisted in conversations or shared across objects. */
export interface McpSession {
  endpoint: string
  sessionId?: string
  nextId: number
  stale: boolean
  bytes: number
}

/** Reauthorize immediately before every send; the callback must check the live grant and binding. */
export type McpAuthorization = (signal: AbortSignal) => Promise<string | undefined>

/** Initialize with no sampling, roots, elicitation, or other client capabilities. */
export async function openMcpSession(
  endpoint: string,
  authorize: McpAuthorization,
  signal: AbortSignal,
): Promise<McpSession> {
  const session: McpSession = { endpoint: mcpEndpoint(endpoint), nextId: 1, stale: false, bytes: 0 }
  const initialization = AbortSignal.any([signal, AbortSignal.timeout(5_000)])
  const result = record(
    await mcpRequest(
      session,
      'initialize',
      {
        protocolVersion: MCP_PROTOCOL,
        capabilities: {},
        clientInfo: { name: 'kodama', version: '1' },
      },
      authorize,
      initialization,
    ),
  )
  if (result.protocolVersion !== MCP_PROTOCOL || !record(result.capabilities).tools)
    throw new Error('mcp_protocol_unsupported')
  // Server instructions are deliberately not adopted as instructions or permissions.
  await mcpRequest(session, 'notifications/initialized', undefined, authorize, initialization, true)
  return session
}

/** Execute exactly one HTTP request; errors never contain remote bodies or session identifiers. */
export async function mcpRequest(
  session: McpSession,
  method: string,
  params: unknown,
  authorize: McpAuthorization,
  signal: AbortSignal,
  notification = false,
): Promise<unknown> {
  signal.throwIfAborted()
  const token = await authorize(signal)
  signal.throwIfAborted()
  const id = notification ? undefined : session.nextId++
  const headers = new Headers({
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': MCP_PROTOCOL,
  })
  if (token !== undefined) headers.set('Authorization', `Bearer ${token}`)
  if (session.sessionId !== undefined) headers.set('MCP-Session-Id', session.sessionId)
  let response: Response
  try {
    response = await fetch(session.endpoint, {
      method: 'POST',
      headers,
      redirect: 'error',
      signal,
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    })
  } catch {
    throw new Error(signal.aborted ? 'mcp_interrupted' : 'mcp_outcome_unknown')
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    if (response.status === 401) throw new Error('mcp_auth_required')
    if (response.status === 403) throw new Error('mcp_scope_required')
    if (response.status === 404 && session.sessionId) {
      delete session.sessionId
      throw new Error('mcp_session_expired')
    }
    throw new Error('mcp_unavailable')
  }
  const receivedSession = response.headers.get('MCP-Session-Id')
  if (receivedSession !== null) {
    if (
      !/^[\x21-\x7e]{1,256}$/u.test(receivedSession) ||
      (session.sessionId !== undefined && session.sessionId !== receivedSession)
    ) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error('mcp_result_invalid')
    }
    session.sessionId = receivedSession
  }
  if (notification && response.status === 202) {
    await response.body?.cancel().catch(() => undefined)
    return undefined
  }
  try {
    const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
    if (type !== 'application/json' && type !== 'text/event-stream') {
      await response.body?.cancel().catch(() => undefined)
      throw new Error('mcp_result_invalid')
    }
    let matched = false
    let result: unknown
    const consume = (value: unknown): boolean => {
      const message = record(value)
      if (message.jsonrpc !== '2.0') throw new Error('mcp_result_invalid')
      if (message.method !== undefined) {
        // Server requests cannot activate unsupported client capabilities.
        if (message.id !== undefined) throw new Error('mcp_server_request_unsupported')
        if (message.method === 'notifications/tools/list_changed') session.stale = true
        return false
      }
      if (notification || message.id !== id || matched) throw new Error('mcp_result_invalid')
      matched = true
      if (message.error !== undefined) throw new Error('mcp_remote_error')
      if (!Object.hasOwn(message, 'result')) throw new Error('mcp_result_invalid')
      result = message.result
      return true
    }
    if (type === 'text/event-stream') {
      await readMcpEvents(response, signal, consume, (bytes) => {
        session.bytes += bytes
      })
    } else {
      const bytes = await readBody(response, MCP_MAX_BYTES, signal)
      session.bytes += bytes.byteLength
      consume(parseJson(decodeUtf8(bytes)))
    }
    if (!notification && !matched) throw new Error('mcp_result_invalid')
    return result
  } catch (error) {
    if (
      error instanceof Error &&
      ['mcp_remote_error', 'mcp_server_request_unsupported'].includes(error.message)
    )
      throw error
    throw new Error(signal.aborted ? 'mcp_interrupted' : 'mcp_result_invalid')
  }
}

// Stop at the completed JSON-RPC response rather than waiting for the peer to close an SSE stream.
async function readMcpEvents(
  response: Response,
  signal: AbortSignal,
  consume: (value: unknown) => boolean,
  observe: (bytes: number) => void,
): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('mcp_result_invalid')
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
  let bytes = 0
  let pending = ''
  let event = ''
  const abort = () => {
    void reader.cancel().catch(() => undefined)
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    while (true) {
      signal.throwIfAborted()
      const chunk = await reader.read()
      signal.throwIfAborted()
      if (chunk.done) {
        decoder.decode()
        throw new Error('mcp_result_invalid')
      }
      bytes += chunk.value.byteLength
      observe(chunk.value.byteLength)
      if (bytes > MCP_MAX_BYTES) throw new Error('mcp_result_invalid')
      pending += decoder.decode(chunk.value, { stream: true })
      while (true) {
        const end = pending.search(/[\r\n]/u)
        if (end < 0 || (pending[end] === '\r' && end === pending.length - 1)) break
        const line = pending.slice(0, end)
        const width = pending[end] === '\r' && pending[end + 1] === '\n' ? 2 : 1
        pending = pending.slice(end + width)
        if (line !== '') event += `${line}\n`
        else {
          for (const data of event === '' ? [] : sseData(`${event}\n`))
            if (consume(parseJson(data))) return
          event = ''
        }
      }
    }
  } finally {
    signal.removeEventListener('abort', abort)
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

/** Obtain a complete catalog or fail without publishing partial pages. */
export async function listMcpTools(
  session: McpSession,
  authorize: McpAuthorization,
  signal: AbortSignal,
): Promise<unknown[]> {
  const tools: unknown[] = []
  const cursors = new Set<string>()
  let cursor: string | undefined
  const startBytes = session.bytes
  for (let page = 0; page < 10; page++) {
    const result = record(
      await mcpRequest(session, 'tools/list', cursor ? { cursor } : {}, authorize, signal),
    )
    tools.push(...array(result.tools))
    if (tools.length > 100 || session.bytes - startBytes > MCP_MAX_BYTES)
      throw new Error('mcp_catalog_limit')
    if (result.nextCursor === undefined) return tools
    if (
      typeof result.nextCursor !== 'string' ||
      !result.nextCursor ||
      cursors.has(result.nextCursor)
    )
      throw new Error('mcp_catalog_invalid')
    cursor = result.nextCursor
    cursors.add(cursor)
  }
  throw new Error('mcp_catalog_limit')
}

/** Best-effort cleanup cannot change a completed call's outcome and never retries a call. */
export async function closeMcpSession(
  session: McpSession,
  authorize: McpAuthorization,
): Promise<void> {
  if (!session.sessionId) return
  try {
    const signal = AbortSignal.timeout(1_000)
    const token = await authorize(signal)
    signal.throwIfAborted()
    const headers = new Headers({
      'MCP-Session-Id': session.sessionId,
      'MCP-Protocol-Version': MCP_PROTOCOL,
    })
    if (token !== undefined) headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(session.endpoint, {
      method: 'DELETE',
      headers,
      signal,
      redirect: 'error',
    })
    await response.body?.cancel().catch(() => undefined)
  } catch {
    // Cleanup is intentionally best effort, without leaking raw transport failures.
  }
}
