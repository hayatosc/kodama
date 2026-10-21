/** The tool that proposes changes to shared spaces; code accepts or rejects each proposal. */
import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-durable'
import type { ToolExecutionApi, ToolRegistration } from '@earendil-works/pi-durable'
import { looksLikeInjection, redactSecrets } from '../../../lib/redact.ts'
import { propose, skillFilesAsBlobs } from '../../shared/proposals.ts'
import type { Proposal } from '../../shared/proposals.ts'
import type { MemoryDb } from '../../store/db.ts'
import { CONTENT, IMPORTANCE, KIND, skillRow, text, toolDb } from './common.ts'
import type { MemoryToolDeps } from './common.ts'
import { sha256Hex } from '../../../lib/hash.ts'

function proposalOutcome(proposal: Proposal): string {
  return proposal.status === 'rejected'
    ? `rejected: ${proposal.reason ?? 'the checks failed'}`
    : `${proposal.status} ${proposal.id}`
}

export function sharedTools(deps: MemoryToolDeps): ToolRegistration[] {
  const db = (): MemoryDb => toolDb(deps)
  const sharedPropose = defineTool({
    name: 'shared_propose',
    description:
      'Propose a change to a shared space: a record (new, or replacing a shared record by id) or an agent skill of the job scope to share. Code accepts it when the cited sources are records or skills of at least two agents, or only records of that space; an accepted proposal is applied after this job.',
    parameters: Type.Object({
      space: Type.String({ pattern: '^[a-z0-9-]{1,64}$' }),
      record: Type.Optional(
        Type.Object({
          kind: KIND,
          content: CONTENT,
          importance: IMPORTANCE,
          required: Type.Optional(
            Type.Boolean({ description: 'A team rule agents cannot override' }),
          ),
          replaces: Type.Optional(
            Type.String({ description: 'ID of the shared record it replaces' }),
          ),
        }),
      ),
      skill: Type.Optional(
        Type.String({ pattern: '^[a-z0-9-]{1,64}$', description: 'Agent skill name' }),
      ),
      sourceIds: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), {
        minItems: 1,
        maxItems: 20,
      }),
    }),
    replay: 'safe',
    execute: async (args, api: ToolExecutionApi) => {
      const running = await deps.runningJob()
      if (running?.job.kind !== 'consolidate')
        throw new Error('shared_propose needs a consolidate job')
      const { scope } = running.job
      if ((args.record === undefined) === (args.skill === undefined)) {
        throw new Error('Propose either a record or a skill')
      }
      const ctx = {
        opId: await sha256Hex(`${running.jobId}:${api.callId}`),
        jobId: running.jobId,
        runId: running.jobId,
        actor: 'memory-agent',
        now: deps.now?.() ?? Date.now(),
      }
      if (args.record !== undefined) {
        const content = redactSecrets(args.record.content.trim())
        if (looksLikeInjection(content))
          throw new Error('The content looks like an instruction to obey')
        const proposal = await propose(db(), ctx, {
          space: args.space,
          payload: {
            type: 'record',
            kind: args.record.kind,
            content,
            ...(args.record.importance === undefined ? {} : { importance: args.record.importance }),
            ...(args.record.required === undefined ? {} : { required: args.record.required }),
            ...(args.record.replaces === undefined ? {} : { replaces: args.record.replaces }),
          },
          sourceIds: args.sourceIds,
        })
        return text(proposalOutcome(proposal))
      }
      const name = args.skill ?? ''
      if (!scope.startsWith('agent:') || (await skillRow(db(), scope, name)) === undefined) {
        throw new Error(`No agent skill ${name} in ${scope}`)
      }
      const files = await skillFilesAsBlobs(deps.env.ARCHIVE, scope, name)
      const proposal = await propose(db(), ctx, {
        space: args.space,
        payload: { type: 'skill', name, files, remove: [] },
        sourceIds: [
          `${scope}/${name}`,
          ...args.sourceIds.filter((id) => id !== `${scope}/${name}`),
        ],
      })
      return text(proposalOutcome(proposal))
    },
  })

  return [sharedPropose]
}
