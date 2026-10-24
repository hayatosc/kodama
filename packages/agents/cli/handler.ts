/**
 * The HTTP adapter the local agent CLI talks to; development only, behind a bearer token.
 *
 * @module
 */
import type { AdminService } from '../src/admin/index.ts'
import type AgentService from '../src/index.ts'
import { isUuid } from '../src/lib/uuid.ts'
import { parseAgentRef, parseMessage } from '../src/validation.ts'

type Service = Pick<AgentService, 'send' | 'snapshot' | 'cancel'>
type Admin = Pick<AdminService, 'seed' | 'resolveAgent'>

/** The actor the development CLI calls `AdminService` as. */
const CLI_ACTOR = { kind: 'service', externalId: 'kodama-dev-cli' } as const

/**
 * The UUID an agent reference names. A slug or UUID prefix is resolved after making sure the seed
 * has run, so `assistant` works on a fresh local database.
 */
async function agentIdOf(admin: Admin, ref: string): Promise<string> {
  if (isUuid(ref)) return ref
  await admin.seed()
  return (await admin.resolveAgent(CLI_ACTOR, ref)).agentId
}

/** Development-only HTTP adapter; service methods deliver through Durable Object RPC. */
export async function handleCli(
  request: Request,
  token: string,
  service: Service,
  admin: Admin,
): Promise<Response> {
  if (!token || request.headers.get('authorization') !== `Bearer ${token}`) {
    return new Response('Unauthorized', { status: 401 })
  }
  if (request.method !== 'POST') return new Response('Use POST', { status: 405 })
  const [, prefix, action, rawAgentRef] = new URL(request.url).pathname.split('/')
  if (prefix !== 'cli') return new Response('Not found', { status: 404 })
  try {
    if (action === 'seed') return Response.json(await admin.seed())
    const agentId = await agentIdOf(admin, parseAgentRef(rawAgentRef))
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
