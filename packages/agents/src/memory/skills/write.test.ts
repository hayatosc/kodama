import { env } from 'cloudflare:workers'
import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { memoryLedger, skillWrites } from '../../../drizzle/d1/schema.ts'
import type { Scope } from '../../../drizzle/d1/schema.ts'
import { finishPendingSkillWrites, writeSkill } from './write.ts'
import { rollbackSkill } from './status.ts'
import { context, db } from '../../testing/memory.ts'
import { create, file, row, skillMd } from '../../testing/skills.ts'
// Load the provider before RPC calls so Vite's module fetch is outside a short-lived DO request.
import '@earendil-works/pi-ai/api/openai-responses'

afterEach(() => vi.restoreAllMocks())

describe('skill storage', () => {
  it('overwrites a skill in place, guarded by the revision the writer read', async () => {
    const scope: Scope = `agent:${crypto.randomUUID()}`
    await create(scope, 'deploy', 'Run wrangler deploy.', { 'references/env.md': 'Use prod.' })
    const first = await row(scope, 'deploy')

    const update = await writeSkill(db, env.ARCHIVE, context(), {
      scope,
      name: 'deploy',
      files: {
        'SKILL.md': skillMd('deploy', 'How to deploy', 'Run pnpm deploy.'),
        'references/env.md': null,
      },
      baseRevision: first?.revision,
      status: 'active',
      evidence: 'test',
    })
    const stale = await writeSkill(db, env.ARCHIVE, context(), {
      scope,
      name: 'deploy',
      files: { 'SKILL.md': skillMd('deploy', 'How to deploy', 'Something else.') },
      baseRevision: first?.revision,
      status: 'active',
      evidence: 'test',
    })

    expect(update.status).toBe('applied')
    expect(stale).toMatchObject({ status: 'conflict', reason: 'target_changed' })
    expect(await file(scope, 'deploy', 'SKILL.md')).toContain('Run pnpm deploy.')
    expect(await file(scope, 'deploy', 'references/env.md')).toBeUndefined()
    expect((await row(scope, 'deploy'))?.revision).toBe(2)
    expect((await row(scope, 'deploy'))?.contentSha256).not.toBe(first?.contentSha256)
  })

  it('rejects a skill whose SKILL.md lacks matching frontmatter, or a file outside its folders', async () => {
    const scope: Scope = `agent:${crypto.randomUUID()}`
    const attempt = (files: Record<string, string>) =>
      writeSkill(db, env.ARCHIVE, context(), {
        scope,
        name: 'deploy',
        files,
        baseRevision: undefined,
        status: 'active',
        evidence: 'test',
      }).then(
        () => 'written',
        (error: unknown) => String(error),
      )

    expect(await attempt({ 'SKILL.md': 'No frontmatter' })).toMatch(/frontmatter/)
    expect(await attempt({ 'SKILL.md': skillMd('other', 'x', 'y') })).toMatch(/name must match/)
    expect(await attempt({ 'SKILL.md': skillMd('deploy', 'x', 'y'), '../escape.md': 'z' })).toMatch(
      /Invalid skill file path/,
    )
    expect(await row(scope, 'deploy')).toBeUndefined()
  })

  it('finishes a write that stopped while the directory was being overwritten', async () => {
    const scope: Scope = `agent:${crypto.randomUUID()}`
    await create(scope, 'release', 'Old steps.', { 'references/notes.md': 'old notes' })
    const base = (await row(scope, 'release'))?.revision
    // Writes to the directory fail after the blobs and the pending row are stored.
    const stopping = new Proxy(env.ARCHIVE, {
      get(target, property, receiver) {
        if (property === 'put') {
          return (key: string, value: string | ArrayBuffer, options?: R2PutOptions) =>
            key.startsWith('skills/.blobs/')
              ? target.put(key, value, options)
              : Promise.reject(new Error('stopped'))
        }
        const value: unknown = Reflect.get(target, property, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })

    const ctx = context()
    const stopped = await writeSkill(db, stopping, ctx, {
      scope,
      name: 'release',
      files: {
        'SKILL.md': skillMd('release', 'How to release', 'New steps.'),
        'references/notes.md': 'new notes',
      },
      baseRevision: base,
      status: 'active',
      evidence: 'test',
    }).then(
      () => 'finished',
      (error: unknown) => String(error),
    )
    expect(stopped).toMatch(/stopped/)
    expect(await file(scope, 'release', 'SKILL.md')).toContain('Old steps.')

    expect(await finishPendingSkillWrites(db, env.ARCHIVE, Date.now())).toBeGreaterThanOrEqual(1)

    expect(await file(scope, 'release', 'SKILL.md')).toContain('New steps.')
    expect(await file(scope, 'release', 'references/notes.md')).toBe('new notes')
    expect((await row(scope, 'release'))?.revision).toBe((base ?? 0) + 1)
    const write = await db.select().from(skillWrites).where(eq(skillWrites.opId, ctx.opId)).get()
    expect(write?.status).toBe('done')
  })

  it('rolls a write back to the files it replaced', async () => {
    const scope: Scope = `agent:${crypto.randomUUID()}`
    await create(scope, 'review', 'Check tests first.')
    const before = await row(scope, 'review')
    await writeSkill(db, env.ARCHIVE, context(), {
      scope,
      name: 'review',
      files: { 'SKILL.md': skillMd('review', 'How to review', 'Skip tests.') },
      baseRevision: before?.revision,
      status: 'active',
      evidence: 'test',
    })
    const write = (
      await db
        .select()
        .from(memoryLedger)
        .where(and(eq(memoryLedger.targetId, `${scope}/review`), eq(memoryLedger.action, 'write')))
    ).at(-1)

    const result = await rollbackSkill(db, env.ARCHIVE, context(), write?.seq ?? 0)

    expect(result.status).toBe('applied')
    expect(await file(scope, 'review', 'SKILL.md')).toContain('Check tests first.')
    expect((await row(scope, 'review'))?.contentSha256).toBe(before?.contentSha256)
  })
})
