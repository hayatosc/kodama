/** Development-only credential adapter; registration is write-only and errors never echo input. @module */
import type AgentService from '../src/index.ts'
import { parseAgentId, parseAgentRef } from '../src/validation.ts'

type Management = Pick<
  AgentService,
  | 'getInstallationId'
  | 'putCredential'
  | 'listCredentials'
  | 'assignCredential'
  | 'unassignCredential'
  | 'revokeCredential'
  | 'resolveAgent'
>

/** Route credential requests only after the outer adapter has authenticated the request. */
export async function credentialResponse(
  request: Request,
  management: Management,
  action?: string,
  id?: string,
  ref?: string,
): Promise<Response> {
  try {
    if (action === 'installation')
      return Response.json({ installId: await management.getInstallationId() })
    if (action === 'add') return Response.json(await management.putCredential(await request.json()))
    if (action === 'list') return Response.json(await management.listCredentials())
    if (action !== 'assign' && action !== 'unassign' && action !== 'revoke')
      return new Response('Not found', { status: 404 })
    const credentialId = parseAgentId(id)
    if (action === 'revoke') return Response.json(await management.revokeCredential(credentialId))
    const agent = await management.resolveAgent(parseAgentRef(ref))
    return Response.json(
      action === 'assign'
        ? await management.assignCredential(credentialId, agent.agentId)
        : await management.unassignCredential(credentialId, agent.agentId),
    )
  } catch {
    return Response.json(
      {
        error: 'Credential operation failed; check the provider, credential, agent and local KEK.',
      },
      { status: 400 },
    )
  }
}
