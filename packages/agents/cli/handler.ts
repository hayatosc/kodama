/**
 * The HTTP adapter the local agent CLI talks to; development only, behind a bearer token.
 *
 * @module
 */
import * as v from 'valibot'
import {
  RequestIdSchema,
  ArtifactUploadSchema,
  ExtensionIdSchema,
  ExtensionPageSchema,
} from '../src/validation.ts'
import { MAX_ARTIFACT_BYTES } from '../src/extensions.ts'
import type AgentService from '../src/index.ts'
import { isUuid } from '../src/lib/uuid.ts'
import { parseAgentRef, parseInput, parseMessage, CreateAgentSchema } from '../src/validation.ts'
import { selectedCredentialRefs } from '../src/credentials/validation.ts'
import { CLI_ACTOR, credentialResponse } from './credentials.ts'

type Service = Pick<
  AgentService,
  | 'send'
  | 'snapshot'
  | 'cancel'
  | 'uploadArtifact'
  | 'listArtifacts'
  | 'downloadArtifact'
  | 'deleteArtifact'
>
async function uploadForm(request: Request): Promise<FormData> {
  if (!request.body) throw new TypeError('Missing upload body')
  const reader = request.body.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > MAX_ARTIFACT_BYTES + 64 * 1024) throw new TypeError('Upload exceeds 10 MiB')
      chunks.push(new Uint8Array(chunk.value))
    }
  } finally {
    await reader.cancel()
  }
  return new Response(new Blob(chunks), { headers: request.headers }).formData()
}

type Management = Pick<
  AgentService,
  | 'seed'
  | 'getInstallationId'
  | 'resolveAgent'
  | 'listAgents'
  | 'createAgent'
  | 'getConfig'
  | 'updateConfig'
  | 'putCredential'
  | 'listCredentials'
  | 'assignCredential'
  | 'unassignCredential'
  | 'revokeCredential'
>

/** Resolve an existing agent without provisioning unrelated initial agents. */
async function agentIdOf(management: Management, ref: string): Promise<string> {
  if (isUuid(ref)) return ref
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
    if (action === 'seed') {
      const input: unknown = await request.text().then((text) => (text ? JSON.parse(text) : {}))
      return Response.json(
        await management.seed(
          selectedCredentialRefs(input, await management.listCredentials(CLI_ACTOR)),
        ),
      )
    }
    if (action === 'list') return Response.json(await management.listAgents(CLI_ACTOR))
    if (action === 'create') {
      const body = parseInput(
        v.strictObject({
          ...v.pick(CreateAgentSchema, ['requestId', 'displayName', 'slug']).entries,
          credentialIds: v.optional(v.unknown()),
        }),
        await request.json(),
      )
      const { credentialIds, ...input } = body
      const credentials = selectedCredentialRefs(
        { credentialIds },
        await management.listCredentials(CLI_ACTOR),
      )
      return Response.json(
        await management.createAgent(CLI_ACTOR, {
          requestId: input.requestId,
          displayName: input.displayName,
          ...(credentials ? { credentials } : {}),
          ...(input.slug === undefined ? {} : { slug: input.slug }),
        }),
      )
    }
    const agentId = await agentIdOf(management, parseAgentRef(rawAgentRef))
    if (action === 'tools') {
      const input = parseInput(
        v.object({ requestId: RequestIdSchema, tools: v.array(v.string()) }),
        await request.json(),
      )
      const current = await management.getConfig(CLI_ACTOR, agentId)
      return Response.json(
        await management.updateConfig(CLI_ACTOR, agentId, {
          requestId: input.requestId,
          expectedVersion: current.version,
          settings: { ...current.settings, tools: input.tools },
        }),
      )
    }
    if (action === 'artifact-upload') {
      const form = await uploadForm(request)
      const file = form.get('file')
      if (!file || typeof file === 'string') throw new TypeError('Missing artifact bytes')
      const input = parseInput(ArtifactUploadSchema, {
        filename: form.get('filename'),
        mediaType: form.get('mediaType'),
        bytes: new Uint8Array(await file.arrayBuffer()),
      })
      return Response.json(await service.uploadArtifact(agentId, input))
    }
    if (action === 'artifact-list')
      return Response.json(
        await service.listArtifacts(agentId, parseInput(ExtensionPageSchema, await request.json())),
      )
    if (action === 'artifact-download' || action === 'artifact-delete') {
      const { artifactId } = parseInput(
        v.strictObject({ artifactId: ExtensionIdSchema }),
        await request.json(),
      )
      if (action === 'artifact-delete') {
        await service.deleteArtifact(agentId, artifactId)
        return Response.json({ deleted: true })
      }
      const file = await service.downloadArtifact(agentId, artifactId)
      return new Response(new Uint8Array(file.bytes), {
        headers: {
          'content-type': 'application/octet-stream',
          'content-disposition': 'attachment; filename="artifact"',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; sandbox",
          'cache-control': 'no-store',
        },
      })
    }
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
