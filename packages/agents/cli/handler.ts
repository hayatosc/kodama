/**
 * The HTTP adapter the local agent CLI talks to; development only, behind a bearer token.
 *
 * @module
 */
import type AgentService from '../src/index.ts'
import { isUuid } from '../src/lib/uuid.ts'
import { parseAgentRef, parseInput, parseMessage, CreateAgentSchema } from '../src/validation.ts'
import { CLI_ACTOR, credentialResponse } from './credentials.ts'

type Service = Pick<AgentService, 'send' | 'snapshot' | 'cancel'>
type Management = Pick<
  AgentService,
  | 'seed'
  | 'resolveAgent'
  | 'listAgents'
  | 'createAgent'
  | 'putCredential'
  | 'listCredentials'
  | 'assignCredential'
  | 'unassignCredential'
  | 'revokeCredential'
>

/**
 * The UUID an agent reference names. A slug or UUID prefix is resolved after making sure the seed
 * has run, so `assistant` works on a fresh local database.
 */
async function agentIdOf(management: Management, ref: string): Promise<string> {
  if (isUuid(ref)) return ref
  await management.seed()
  return (await management.resolveAgent(CLI_ACTOR, ref)).agentId
}

/** Development-only HTTP adapter; service methods deliver through Durable Object RPC. */
export async function handleCli(
  request: Request,
  token: string,
  service: Service,
  management: Management,
): Promise<Response> {
  if (!token || request.headers.get('authorization') !== `Bearer ${token}`) {
    return new Response('Unauthorized', { status: 401 })
  }
  if (request.method !== 'POST') return new Response('Use POST', { status: 405 })
  const [, prefix, action, rawAgentRef, credentialId, target] = new URL(request.url).pathname.split(
    '/',
  )
  if (prefix !== 'cli') return new Response('Not found', { status: 404 })
  try {
    if (action === 'credentials')
      return credentialResponse(request, management, rawAgentRef, credentialId, target)
    if (action === 'seed') return Response.json(await management.seed())
    if (action === 'list') return Response.json(await management.listAgents(CLI_ACTOR))
    if (action === 'create') {
      const input = parseInput(CreateAgentSchema, await request.json())
      return Response.json(
        await management.createAgent(CLI_ACTOR, {
          requestId: input.requestId,
          displayName: input.displayName,
          ...(input.slug === undefined ? {} : { slug: input.slug }),
        }),
      )
    }
    const agentId = await agentIdOf(management, parseAgentRef(rawAgentRef))
    if (action === 'snapshot') return Response.json(await service.snapshot(agentId))
    if (action === 'cancel') {
      await service.cancel(agentId)
      return Response.json({ cancelled: true })
    }
    if (action !== 'send') return new Response('Not found', { status: 404 })
    const message = parseMessage(await request.json())
    const stream = await service.send(agentId, message)
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: error instanceof TypeError || error instanceof SyntaxError ? 400 : 500 },
    )
  }
}
