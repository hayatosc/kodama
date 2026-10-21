import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { applyOperation, memoryDb, searchMemory } from '../src/memory/records.ts'
import type { NewRecord, OperationContext, Scope } from '../src/memory/records.ts'

const d1 = env.MEMORY_DB
const db = memoryDb(d1)
const NOW = Date.UTC(2026, 9, 1)

function agentScope(): { scope: Scope; agentId: string } {
  const agentId = crypto.randomUUID()
  return { scope: `agent:${agentId}`, agentId }
}

function context(opId: string, overrides: Partial<OperationContext> = {}): OperationContext {
  return { opId, jobId: 'job', runId: 'run', actor: 'test', now: NOW, ...overrides }
}

function fact(scope: Scope, agentId: string, content: string, entryTo: number): NewRecord {
  return {
    scope,
    kind: 'fact',
    content,
    origin: 'extraction',
    sourceAgentId: agentId,
    sourceEntries: { from: entryTo, to: entryTo },
    observedAt: NOW,
  }
}

async function activeContents(scope: Scope): Promise<string[]> {
  const { results } = await d1
    .prepare("SELECT content FROM memory_records WHERE scope = ? AND status = 'active'")
    .bind(scope)
    .all<{ content: string }>()
  return results.map((row) => row.content)
}

async function revision(id: string): Promise<number | undefined> {
  const row = await d1
    .prepare('SELECT revision FROM memory_records WHERE id = ?')
    .bind(id)
    .first<{ revision: number }>()
  return row?.revision
}

async function written(scope: Scope, agentId: string, content: string, entry: number) {
  const result = await applyOperation(db, context(crypto.randomUUID()), {
    type: 'write',
    record: fact(scope, agentId, content, entry),
  })
  if (result.status !== 'applied') throw new Error(`write failed: ${result.status}`)
  return result.recordId
}

describe('applying operations', () => {
  it('applies the same supersede once when it is repeated', async () => {
    const { scope, agentId } = agentScope()
    const oldId = await written(scope, agentId, 'uses npm', 100)
    const op = {
      type: 'supersede',
      oldId,
      oldRevision: 1,
      record: fact(scope, agentId, 'uses pnpm', 150),
    } as const

    const first = await applyOperation(db, context('op-supersede'), op)
    const repeat = await applyOperation(db, context('op-supersede'), op)

    expect(first).toMatchObject({ status: 'applied', replayed: false })
    expect(repeat).toEqual({ ...first, replayed: true })
    expect(await activeContents(scope)).toEqual(['uses pnpm'])
  })

  it('returns conflict and changes nothing when the target revision is outdated', async () => {
    const { scope, agentId } = agentScope()
    const oldId = await written(scope, agentId, 'uses npm', 100)
    await applyOperation(db, context(crypto.randomUUID()), {
      type: 'supersede',
      oldId,
      oldRevision: 1,
      record: fact(scope, agentId, 'uses pnpm', 150),
    })

    const late = await applyOperation(db, context(crypto.randomUUID()), {
      type: 'supersede',
      oldId,
      oldRevision: 1,
      record: fact(scope, agentId, 'uses yarn', 160),
    })

    expect(late).toEqual({ status: 'conflict', reason: 'target_changed', replayed: false })
    expect(await activeContents(scope)).toEqual(['uses pnpm'])
  })

  it('rolls the batch back when the target changes after the precondition read', async () => {
    const { scope, agentId } = agentScope()
    const oldId = await written(scope, agentId, 'uses npm', 100)

    const result = await applyOperation(
      db,
      context(crypto.randomUUID(), {
        // Another writer changes the record between the read and the batch.
        beforeBatch: async () => {
          await d1
            .prepare('UPDATE memory_records SET revision = revision + 1 WHERE id = ?')
            .bind(oldId)
            .run()
        },
      }),
      { type: 'supersede', oldId, oldRevision: 1, record: fact(scope, agentId, 'uses pnpm', 150) },
    )

    expect(result).toEqual({ status: 'conflict', reason: 'changed_during_write', replayed: false })
    expect(await activeContents(scope)).toEqual(['uses npm'])
    expect(await revision(oldId)).toBe(2)
  })

  it('declines a candidate built on older entries than the record it would replace', async () => {
    const { scope, agentId } = agentScope()
    const correction = await written(scope, agentId, 'uses pnpm', 150)

    const oldExtraction = await applyOperation(db, context(crypto.randomUUID()), {
      type: 'supersede',
      oldId: correction,
      oldRevision: 1,
      record: fact(scope, agentId, 'uses npm', 100),
    })

    expect(oldExtraction).toMatchObject({ status: 'stale' })
    expect(await activeContents(scope)).toEqual(['uses pnpm'])
  })

  it('does not let one agent supersede the record of another', async () => {
    const { scope, agentId } = agentScope()
    const oldId = await written(scope, agentId, 'uses npm', 100)

    const result = await applyOperation(db, context(crypto.randomUUID()), {
      type: 'supersede',
      oldId,
      oldRevision: 1,
      record: fact(scope, 'other-agent', 'uses pnpm', 150),
    })

    expect(result).toMatchObject({ status: 'conflict', reason: 'other_agent' })
    expect(await activeContents(scope)).toEqual(['uses npm'])
  })

  it('reports a second write of the same content from the same source as a duplicate', async () => {
    const { scope, agentId } = agentScope()
    await written(scope, agentId, 'uses pnpm', 150)

    const again = await applyOperation(db, context(crypto.randomUUID()), {
      type: 'write',
      record: fact(scope, agentId, 'uses pnpm', 150),
    })

    expect(again).toEqual({ status: 'conflict', reason: 'duplicate', replayed: false })
  })

  it('advances the scope revision for facts but not for events', async () => {
    const { scope, agentId } = agentScope()
    const current = async () =>
      (
        await d1
          .prepare('SELECT revision FROM scope_revisions WHERE scope = ?')
          .bind(scope)
          .first<{ revision: number }>()
      )?.revision

    await applyOperation(db, context(crypto.randomUUID()), {
      type: 'write',
      record: { ...fact(scope, agentId, 'deployed on Friday', 10), kind: 'event' },
    })
    expect(await current()).toBeUndefined()
    await written(scope, agentId, 'uses pnpm', 20)
    expect(await current()).toBe(1)
  })
})

describe('searching memory', () => {
  const documents = [
    'このリポジトリでは pnpm を使う',
    'Worker をデプロイする手順',
    'パッケージマネージャーは bun に変更した',
    'コードレビューの観点を決めた',
    'サーバーレスで動かす',
    'ベストプラクティスに従う',
  ]

  it.each([
    ['使う', 'このリポジトリでは pnpm を使う'],
    ['リポジトリ', 'このリポジトリでは pnpm を使う'],
    ['リポ', 'このリポジトリでは pnpm を使う'],
    ['ＰＮＰＭ 使う', 'このリポジトリでは pnpm を使う'],
    ['デプ', 'Worker をデプロイする手順'],
    ['マネージャー', 'パッケージマネージャーは bun に変更した'],
    ['レビュー', 'コードレビューの観点を決めた'],
    ['サーバレス', 'サーバーレスで動かす'],
    ['サーバーレス', 'サーバーレスで動かす'],
    ['ベストプラクティス', 'ベストプラクティスに従う'],
  ])('finds the record for the Japanese query %s', async (query, expected) => {
    const { scope, agentId } = agentScope()
    for (const [index, content] of documents.entries()) {
      await written(scope, agentId, content, index)
    }

    const found = await searchMemory(db, { query, scopes: [scope], now: NOW })

    expect(found.map((record) => record.content)).toContain(expected)
  })

  it('searches only the given scopes and counts the returned records as used', async () => {
    const mine = agentScope()
    const other = agentScope()
    const id = await written(mine.scope, mine.agentId, 'このリポジトリでは pnpm を使う', 1)
    await written(other.scope, other.agentId, 'このリポジトリでは pnpm を使う', 1)

    const found = await searchMemory(db, { query: 'pnpm', scopes: [mine.scope], now: NOW })

    expect(found.map((record) => record.id)).toEqual([id])
    const used = await d1
      .prepare('SELECT use_count, last_used_at FROM memory_records WHERE id = ?')
      .bind(id)
      .first<{ use_count: number; last_used_at: number }>()
    expect(used).toEqual({ use_count: 1, last_used_at: NOW })
  })

  it('returns nothing for a query without words', async () => {
    const { scope } = agentScope()
    expect(await searchMemory(db, { query: '、。', scopes: [scope], now: NOW })).toEqual([])
  })
})
