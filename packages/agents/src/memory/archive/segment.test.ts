/**
 * Archive word indexes preserve arbitrary normalized words through R2 and validation.
 *
 * @module
 */
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { archiveSegments } from '../../../drizzle/d1/schema.ts'
import { db } from '../../helper/memory.ts'
import { searchHistory } from './history.ts'
import { indexSchema, readJson, readSegment } from './reader.ts'
import { buildSegment, exportSegment, segmentId, segmentPrefix } from './segment.ts'

async function archive(content: string) {
  const agentId = crypto.randomUUID()
  const record = {
    id: 1,
    kind: 'pi.user',
    model: [{ role: 'user', content, timestamp: 1_000 }],
  }
  const files = await buildSegment(agentId, [{ id: 1, record: JSON.stringify(record) }], 1_000)
  const prefix = segmentPrefix(agentId, 1, 1)
  await exportSegment(env.ARCHIVE, prefix, files)
  await db.insert(archiveSegments).values({
    id: segmentId(agentId, 1, 1),
    agentId,
    firstEntry: 1,
    lastEntry: 1,
    entryCount: 1,
    r2Prefix: prefix,
    sha256: files.manifest.sha256,
    bytes: files.manifest.bytes,
    firstAt: 1_000,
    lastAt: 1_000,
    createdAt: 1_000,
  })
  return { agentId, prefix, files, record }
}

describe('archive word indexes', () => {
  it('exports, reads, and searches a constructor word without losing it during validation', async () => {
    const { agentId, prefix, record } = await archive('A constructor initializes the widget')
    const index = await readJson(env.ARCHIVE, `${prefix}.index.json`, indexSchema)
    expect(index?.value.words['constructor']).toEqual([0])
    expect(await readSegment(env.ARCHIVE, prefix)).toEqual([{ id: 1, entry: record }])
    for (const query of ['constructor', 'constr', 'widget']) {
      const found = await searchHistory(db, env.ARCHIVE, agentId, query)
      expect(found.hits).toEqual([
        {
          firstEntry: 1,
          lastEntry: 1,
          at: 1_000,
          text: '#1 user: A constructor initializes the widget',
        },
      ])
    }
  })

  it('returns no hits for a constructor query absent from the archive', async () => {
    const { agentId } = await archive('A widget opens the window')
    const found = await searchHistory(db, env.ARCHIVE, agentId, 'constructor')
    expect(found.hits).toEqual([])
  })

  it('keeps reading format-one dictionary indexes and Unicode words', async () => {
    const { agentId, prefix, files } = await archive('東京の図書館へ行く')
    await env.ARCHIVE.put(
      `${prefix}.index.json`,
      JSON.stringify({
        format: 1,
        searchVersion: 1,
        chunks: files.index.chunks,
        words: { 東京: [0] },
      }),
    )
    const found = await searchHistory(db, env.ARCHIVE, agentId, '東京')
    expect(found.hits.map((hit) => hit.text)).toEqual(['#1 user: 東京の図書館へ行く'])
  })

  it('preserves prototype-named own keys as data when reading an index', async () => {
    const key = `archive/${crypto.randomUUID()}.index.json`
    await env.ARCHIVE.put(
      key,
      '{"format":1,"searchVersion":1,"chunks":[],"words":{"constructor":[0],"__proto__":[1],"prototype":[2]}}',
    )
    const index = await readJson(env.ARCHIVE, key, indexSchema)
    expect(Object.entries(index?.value.words ?? {})).toEqual([
      ['constructor', [0]],
      ['__proto__', [1]],
      ['prototype', [2]],
    ])
  })

  it('validates prototype-named values rather than silently discarding them', async () => {
    const key = `archive/${crypto.randomUUID()}.index.json`
    await env.ARCHIVE.put(
      key,
      '{"format":1,"searchVersion":1,"chunks":[],"words":{"constructor":"invalid"}}',
    )
    await expect(readJson(env.ARCHIVE, key, indexSchema)).rejects.toThrow()
  })
})
