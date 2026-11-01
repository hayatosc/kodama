/** Dynamic Worker execution, agent-scoped caching and optional real npm compilation. @module */
import { env } from 'cloudflare:workers'
import * as bundler from '@cloudflare/worker-bundler'
import { afterEach, beforeEach, describe, expect, inject, it, vi } from 'vitest'
import { createCodeExecutor, createCodeTool } from './execute.ts'
import type { ArtifactUpload } from '../../extensions.ts'
import { MAX_ARTIFACT_BYTES } from '../../extensions.ts'

function fileStore(inputs: ArtifactUpload[] = []) {
  const outputs: ArtifactUpload[] = []
  return {
    outputs,
    read: vi.fn(async (id: string) => {
      const file = inputs[Number(id.replace('input', ''))]
      if (!file) throw new Error('artifact_unavailable')
      return file
    }),
    write: vi.fn(async (file: ArtifactUpload) => {
      outputs.push(file)
      return {
        artifactId: `output${outputs.length}`,
        filename: file.filename,
        mediaType: file.mediaType,
        size: file.bytes.byteLength,
        createdAt: 1,
        expiresAt: 2,
      }
    }),
    remove: vi.fn(async (_id: string) => undefined),
  }
}

declare module 'vitest' {
  interface ProvidedContext {
    /** Opt into real registry requests; normal tests stay offline. */
    codeNpmSmoke: boolean
  }
}

const allow = async () => undefined
let executeCode: ReturnType<typeof createCodeExecutor>
beforeEach(() => {
  executeCode = createCodeExecutor(env.CODE_LOADER, crypto.randomUUID())
})
afterEach(() => vi.restoreAllMocks())

function trackedLoader() {
  return {
    get: vi.fn<WorkerLoader['get']>((id, getCode) => env.CODE_LOADER.get(id, getCode)),
    load: vi.fn<WorkerLoader['load']>((code) => env.CODE_LOADER.load(code)),
  }
}

describe('binary file execution', () => {
  it('round trips image and ZIP bytes, selecting only explicitly named inputs', async () => {
    const image = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      ),
      (c) => c.charCodeAt(0),
    )
    const zip = new Uint8Array([80, 75, 5, 6, ...Array.from({ length: 18 }, () => 0)])
    const inputs = [
      { filename: 'pixel.png', mediaType: 'image/png', bytes: image },
      { filename: 'empty.zip', mediaType: 'application/zip', bytes: zip },
      { filename: 'not-selected', mediaType: 'text/plain', bytes: new Uint8Array([99]) },
    ]
    const store = fileStore(inputs)
    const execute = createCodeExecutor(env.CODE_LOADER, crypto.randomUUID(), store)
    const result: unknown = JSON.parse(
      await execute(
        {
          code: 'export default (input, files) => ({ result: input, files })',
          input: { copied: true },
          files: ['input0', 'input1'],
        },
        allow,
      ),
    )
    expect(result).toMatchObject({
      result: { copied: true },
      files: [{ filename: 'pixel.png' }, { filename: 'empty.zip' }],
    })
    expect(store.outputs).toEqual(inputs.slice(0, 2))
    expect(store.read.mock.calls).toEqual([['input0'], ['input1']])
  })

  it('uses a fresh isolate for file calls so unselected bytes cannot survive in globals', async () => {
    const store = fileStore([
      {
        filename: 'secret.bin',
        mediaType: 'application/octet-stream',
        bytes: new Uint8Array([42]),
      },
    ])
    const execute = createCodeExecutor(env.CODE_LOADER, crypto.randomUUID(), store)
    const code =
      'let previous; export default (_, files) => { const result = previous ?? null; previous = files[0]?.bytes[0]; return { result, files: [] } }'
    await execute({ code, files: ['input0'] }, allow)
    expect(JSON.parse(await execute({ code, files: [] }, allow))).toEqual({
      result: null,
      files: [],
    })
    expect(await execute({ code: 'export default () => typeof previous' }, allow)).toBe(
      '"undefined"',
    )
  })

  it('blocks outbound network and exposes no host bindings in file mode', async () => {
    const store = fileStore()
    const execute = createCodeExecutor(env.CODE_LOADER, crypto.randomUUID(), store)
    const result: unknown = JSON.parse(
      await execute(
        {
          files: [],
          code: `import { env } from 'cloudflare:workers'
      export default async () => {
        let network = false
        try { await fetch('https://example.com') } catch { network = true }
        return { result: { bindings: Object.keys(env), network }, files: [] }
      }`,
        },
        allow,
      ),
    )
    expect(result).toEqual({ result: { bindings: [], network: true }, files: [] })
  })

  it('disables the filesystem module, including temporary files', async () => {
    const execute = createCodeExecutor(env.CODE_LOADER, crypto.randomUUID(), fileStore())
    await expect(
      execute(
        {
          files: [],
          code: `import * as fs from 'node:fs'; export default () => ({result:Object.keys(fs),files:[]})`,
        },
        allow,
      ),
    ).rejects.toThrow(/No such module/)
  })

  it('preserves JSON-mode Node compatibility even when the same source also runs in file mode', async () => {
    const execute = createCodeExecutor(env.CODE_LOADER, crypto.randomUUID(), fileStore())
    const code = `import { Buffer } from 'node:buffer'; export default () => Buffer.from([1,2,255]).toString('hex')`
    expect(await execute({ code }, allow)).toBe('"0102ff"')
    await expect(execute({ code, files: [] }, allow)).rejects.toThrow(/No such module/)
    expect(await execute({ code }, allow)).toBe('"0102ff"')
  })

  it('refuses fs/promises access rather than relying on the incomplete fs-only opt-out', async () => {
    const execute = createCodeExecutor(env.CODE_LOADER, crypto.randomUUID(), fileStore())
    await expect(
      execute(
        {
          files: [],
          code: `
      import { writeFile, readFile } from 'node:fs/promises'
      export default async () => {
        await writeFile('/tmp/unselected', new Uint8Array([1]))
        return {result: await readFile('/bundle/bundle.js'), files: []}
      }`,
        },
        allow,
      ),
    ).rejects.toThrow(/No such module/)
  })

  it('refuses missing and duplicate IDs without executing or saving outputs', async () => {
    const store = fileStore()
    const execute = createCodeExecutor(env.CODE_LOADER, crypto.randomUUID(), store)
    for (const files of [['input0'], ['input0', 'input0']])
      await expect(
        execute(
          { code: 'export default () => { throw new Error("should_not_run") }', files },
          allow,
        ),
      ).rejects.toThrow(/artifact_unavailable|code_duplicate_input_file/)
    expect(store.write).not.toHaveBeenCalled()
  })

  it('caps aggregate inputs, not only individual files', async () => {
    const store = fileStore(
      Array.from({ length: 2 }, () => ({
        filename: 'large.bin',
        mediaType: 'application/octet-stream',
        bytes: new Uint8Array(MAX_ARTIFACT_BYTES / 2 + 1),
      })),
    )
    const execute = createCodeExecutor(env.CODE_LOADER, crypto.randomUUID(), store)
    await expect(
      execute({ code: 'export default () => ({ files: [] })', files: ['input0', 'input1'] }, allow),
    ).rejects.toThrow('code_input_byte_limit')
    expect(store.write).not.toHaveBeenCalled()
  })

  it.each([
    [
      'count',
      'Array.from({length:5}, () => ({filename:"x",mediaType:"application/octet-stream",bytes:new Uint8Array()}))',
    ],
    [
      'aggregate',
      `Array.from({length:2}, () => ({filename:"x",mediaType:"application/octet-stream",bytes:new Uint8Array(${MAX_ARTIFACT_BYTES / 2 + 1})}))`,
    ],
    ['filename', '[{filename:"../x",mediaType:"text/plain",bytes:new Uint8Array([1])}]'],
    ['bytes', '[{filename:"x",mediaType:"text/plain",bytes:[1]}]'],
  ])('rejects invalid output %s before persisting any file', async (_, expression) => {
    const store = fileStore()
    const execute = createCodeExecutor(env.CODE_LOADER, crypto.randomUUID(), store)
    await expect(
      execute(
        { code: `export default () => ({result:null,files:${expression}})`, files: [] },
        allow,
      ),
    ).rejects.toThrow()
    expect(store.write).not.toHaveBeenCalled()
  })

  it('accepts four outputs and exactly 10 MiB of aggregate output bytes', async () => {
    const store = fileStore()
    const execute = createCodeExecutor(env.CODE_LOADER, crypto.randomUUID(), store)
    await execute(
      {
        code: `export default () => ({ result: 4, files: Array.from({length:4},(_,i)=>({filename:i+'.bin',mediaType:'application/octet-stream',bytes:new Uint8Array(${MAX_ARTIFACT_BYTES / 4})})) })`,
        files: [],
      },
      allow,
    )
    expect(store.outputs).toHaveLength(4)
    expect(store.outputs.reduce((sum, f) => sum + f.bytes.byteLength, 0)).toBe(MAX_ARTIFACT_BYTES)
  })

  it('rechecks permission after reading inputs and before saving outputs', async () => {
    const store = fileStore()
    const execute = createCodeExecutor(env.CODE_LOADER, crypto.randomUUID(), store)
    let checks = 0
    await expect(
      execute(
        {
          code: 'export default () => ({files:[{filename:"x",mediaType:"text/plain",bytes:new Uint8Array()}]})',
          files: [],
        },
        async () => {
          if (++checks === 4) throw new Error('code_disabled')
        },
      ),
    ).rejects.toThrow('code_disabled')
    expect(store.write).not.toHaveBeenCalled()
  })

  it('checks cancellation after output admission before saving bytes', async () => {
    const store = fileStore()
    const execute = createCodeExecutor(env.CODE_LOADER, crypto.randomUUID(), store)
    const controller = new AbortController()
    let checks = 0
    await expect(
      execute(
        {
          code: 'export default () => ({files:[{filename:"x",mediaType:"text/plain",bytes:new Uint8Array()}]})',
          files: [],
        },
        async () => {
          if (++checks === 4) controller.abort()
        },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(store.write).not.toHaveBeenCalled()
  })

  it.each([
    ['count', 'Array.from({length:5},()=>({filename:"x",mediaType:"text/plain"}))', '0'],
    [
      'aggregate',
      '[{filename:"x",mediaType:"text/plain"},{filename:"y",mediaType:"text/plain"}]',
      String(MAX_ARTIFACT_BYTES / 2 + 1),
    ],
    ['filename', '[{filename:"../x",mediaType:"text/plain"}]', '0'],
  ])(
    'host validates forged multipart output %s even when code replaces wrapper globals',
    async (_, manifest, size) => {
      const store = fileStore()
      const execute = createCodeExecutor(env.CODE_LOADER, crypto.randomUUID(), store)
      const code = `const OriginalResponse = Response
      globalThis.Response = function () {
        const form = new FormData()
        const meta = ${manifest}
        form.set('manifest', JSON.stringify(meta))
        form.set('result', 'null')
        meta.forEach((_,i)=>form.set('file'+i,new Blob([new Uint8Array(${size})])))
        return new OriginalResponse(form)
      }
      export default () => ({files:[]})`
      await expect(execute({ code, files: [] }, allow)).rejects.toThrow()
      expect(store.write).not.toHaveBeenCalled()
    },
  )

  it('rolls back already saved outputs when a later output fails', async () => {
    const store = fileStore()
    const execute = createCodeExecutor(env.CODE_LOADER, crypto.randomUUID(), store)
    // The first save succeeds; the second fails after the first acquired a durable ID.
    store.write
      .mockResolvedValueOnce({
        artifactId: 'saved',
        filename: 'x',
        mediaType: 'text/plain',
        size: 0,
        createdAt: 1,
        expiresAt: 2,
      })
      .mockRejectedValueOnce(new Error('r2_failure'))
    await expect(
      execute(
        {
          code: 'export default () => ({files:Array.from({length:2},()=>({filename:"x",mediaType:"text/plain",bytes:new Uint8Array()}))})',
          files: [],
        },
        allow,
      ),
    ).rejects.toThrow('r2_failure')
    expect(store.remove).toHaveBeenCalledWith('saved')
  })
})

describe('code execution', () => {
  it('runs TypeScript with JSON input and async output', async () => {
    expect(
      await executeCode(
        {
          code: 'export default async (input: { values: number[] }) => ({ total: input.values.reduce((a, b) => a + b, 0) })',
          input: { values: [20, 22] },
        },
        allow,
      ),
    ).toBe('{"total":42}')
  })

  it('defaults input to null', async () => {
    expect(await executeCode({ code: 'export default input => input' }, allow)).toBe('null')
  })

  it('exposes no host bindings and blocks outbound fetch', async () => {
    expect(
      await executeCode(
        {
          code: `import { env } from 'cloudflare:workers'
        export default async () => {
          let blocked = false
          try { await fetch('https://example.com') } catch { blocked = true }
          return { bindings: Object.keys(env), blocked }
        }`,
        },
        allow,
      ),
    ).toBe('{"bindings":[],"blocked":true}')
  })

  it('rejects cancelled calls before compilation', async () => {
    await expect(
      executeCode({ code: 'not valid source' }, allow, AbortSignal.abort()),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it.each([1, 2])('rechecks cancellation after admission %s', async (cancelAt) => {
    const controller = new AbortController()
    let admissions = 0
    await expect(
      executeCode(
        { code: 'export default () => 1' },
        async () => {
          if (++admissions === cancelAt) controller.abort()
        },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it.each([1, 2])(
    'stops when admission %s refuses, before compilation or execution',
    async (refuseAt) => {
      let admissions = 0
      await expect(
        executeCode(
          {
            code:
              refuseAt === 1
                ? 'not valid source'
                : 'export default () => { throw new Error("should not run") }',
          },
          async () => {
            if (++admissions === refuseAt) throw new Error('code_disabled')
          },
        ),
      ).rejects.toThrow('code_disabled')
      expect(admissions).toBe(refuseAt)
    },
  )

  it('propagates compiler and runtime failures', async () => {
    await expect(executeCode({ code: 'export default {' }, allow)).rejects.toThrow()
    await expect(
      executeCode({ code: 'export default () => { throw new Error("program_failed") }' }, allow),
    ).rejects.toThrow('program_failed')
  })

  it('rejects non-success responses instead of returning their bodies as tool output', async () => {
    await expect(
      executeCode(
        {
          code: `Response.json = () => new Response('failure body', { status: 500 })
          export default () => 1`,
        },
        allow,
      ),
    ).rejects.toMatchObject({ message: 'code_execution_failed: HTTP 500' })
  })

  it('marks tool executions unsafe to replay after interruption', () => {
    expect(createCodeTool().replay).toBe('unsafe')
  })
})

describe('code caching', () => {
  it('compiles concurrent identical sources once and sends each input separately', async () => {
    const compile = vi.spyOn(bundler, 'createWorker')
    const loader = trackedLoader()
    const execute = createCodeExecutor(loader, crypto.randomUUID())
    const code = 'export default input => input * 2'
    expect(
      await Promise.all([execute({ code, input: 21 }, allow), execute({ code, input: 3 }, allow)]),
    ).toEqual(['42', '6'])
    expect(await execute({ code, input: 5 }, allow)).toBe('10')
    expect(compile).toHaveBeenCalledTimes(1)
    expect(loader.get).toHaveBeenCalledTimes(3)
    expect(new Set(loader.get.mock.calls.map(([id]) => id)).size).toBe(1)
    expect(loader.load).not.toHaveBeenCalled()
  })

  it('normalizes dictionary order, but recompiles when source or aliases change', async () => {
    const compile = vi.spyOn(bundler, 'createWorker')
    const source = {
      code: 'import a from "a"; import b from "b"; export default () => a + b',
      virtualModules: { a: 'export default 1', b: 'export default 2' },
    }
    expect(await executeCode(source, allow)).toBe('3')
    expect(
      await executeCode(
        { ...source, virtualModules: { b: 'export default 2', a: 'export default 1' } },
        allow,
      ),
    ).toBe('3')
    expect(compile).toHaveBeenCalledTimes(1)
    expect(
      await executeCode(
        { ...source, virtualModules: { ...source.virtualModules, a: 'export default 5' } },
        allow,
      ),
    ).toBe('7')
    expect(await executeCode({ ...source, code: 'export default () => 9' }, allow)).toBe('9')
    expect(compile).toHaveBeenCalledTimes(3)
  })

  it('reuses compilation when distinct Unicode aliases are inserted in a different order', async () => {
    const compile = vi.spyOn(bundler, 'createWorker')
    const composed = '\u00e9'
    const decomposed = 'e\u0301'
    const code = `import a from '${composed}'; import b from '${decomposed}'; export default () => a + b`
    const first = { [composed]: 'export default 1', [decomposed]: 'export default 2' }
    const reversed = { [decomposed]: 'export default 2', [composed]: 'export default 1' }
    expect(await executeCode({ code, virtualModules: first }, allow)).toBe('3')
    expect(await executeCode({ code, virtualModules: reversed }, allow)).toBe('3')
    expect(compile).toHaveBeenCalledTimes(1)
  })

  it('keeps Worker identity stable when distinct Unicode modules are inserted in a different order', async () => {
    const entrypoint = { 'index.js': 'export default { fetch() { return Response.json(1) } }' }
    const composed = { '\u00e9.txt': { text: 'first' } }
    const decomposed = { 'e\u0301.txt': { text: 'second' } }
    vi.spyOn(bundler, 'createWorker')
      .mockResolvedValueOnce({
        mainModule: 'index.js',
        modules: { ...entrypoint, ...composed, ...decomposed },
      })
      .mockResolvedValueOnce({
        mainModule: 'index.js',
        modules: { ...entrypoint, ...decomposed, ...composed },
      })
    const loader = trackedLoader()
    const agentId = crypto.randomUUID()
    const source = { code: 'export default () => 1' }
    expect(await createCodeExecutor(loader, agentId)(source, allow)).toBe('1')
    expect(await createCodeExecutor(loader, agentId)(source, allow)).toBe('1')
    expect(loader.get).toHaveBeenCalledTimes(2)
    expect(loader.get.mock.calls[0]?.[0]).toBe(loader.get.mock.calls[1]?.[0])
  })

  it('checks permissions and cancellation even when compilation is cached', async () => {
    const compile = vi.spyOn(bundler, 'createWorker')
    const loader = trackedLoader()
    const execute = createCodeExecutor(loader, crypto.randomUUID())
    const source = { code: 'export default () => 1' }
    await execute(source, allow)
    await expect(
      execute(source, async () => {
        throw new Error('code_disabled')
      }),
    ).rejects.toThrow('code_disabled')
    await expect(execute(source, allow, AbortSignal.abort())).rejects.toMatchObject({
      name: 'AbortError',
    })
    let admissions = 0
    await expect(
      execute(source, async () => {
        if (++admissions === 2) throw new Error('code_disabled')
      }),
    ).rejects.toThrow('code_disabled')
    expect(compile).toHaveBeenCalledTimes(1)
    expect(loader.get).toHaveBeenCalledTimes(1)
  })

  it('uses distinct Worker identities for different agents and shares no globals between them', async () => {
    const loader = trackedLoader()
    const first = createCodeExecutor(loader, crypto.randomUUID())
    const second = createCodeExecutor(loader, crypto.randomUUID())
    const source = { code: 'let calls = 0; export default () => ++calls' }
    expect(await first(source, allow)).toBe('1')
    expect(await second(source, allow)).toBe('1')
    expect(loader.get.mock.calls[0]?.[0]).not.toBe(loader.get.mock.calls[1]?.[0])
  })

  it('retains only the most recent compilation, but preserves content identities after eviction', async () => {
    const compile = vi.spyOn(bundler, 'createWorker')
    const loader = trackedLoader()
    const execute = createCodeExecutor(loader, crypto.randomUUID())
    const first = { code: 'export default () => 1' }
    await execute(first, allow)
    await execute({ code: 'export default () => 2' }, allow)
    await execute(first, allow)
    expect(compile).toHaveBeenCalledTimes(3)
    expect(loader.get.mock.calls[0]?.[0]).toBe(loader.get.mock.calls[2]?.[0])
    expect(loader.get.mock.calls[0]?.[0]).not.toBe(loader.get.mock.calls[1]?.[0])
  })

  it('retries failed compilations instead of caching rejections', async () => {
    const compile = vi.spyOn(bundler, 'createWorker')
    for (let i = 0; i < 2; i++) {
      await expect(executeCode({ code: 'export default {' }, allow)).rejects.toThrow()
    }
    expect(compile).toHaveBeenCalledTimes(2)
  })

  it('does not let one cancelled caller poison a shared compilation', async () => {
    const original = bundler.createWorker
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const compile = vi.spyOn(bundler, 'createWorker').mockImplementationOnce(async (options) => {
      started.resolve()
      await release.promise
      return original(options)
    })
    const controller = new AbortController()
    const source = { code: 'export default input => input' }
    const first = executeCode({ ...source, input: 1 }, allow, controller.signal)
    await started.promise
    const second = executeCode({ ...source, input: 2 }, allow)
    controller.abort()
    release.resolve()
    await Promise.all([
      expect(first).rejects.toMatchObject({ name: 'AbortError' }),
      expect(second).resolves.toBe('2'),
    ])
    expect(compile).toHaveBeenCalledTimes(1)
  })

  it('normalizes dependencies and hashes resolved module bytes, not only version ranges', async () => {
    const compile = vi.spyOn(bundler, 'createWorker')
    const output = (byte: number) => ({
      mainModule: 'index.js',
      modules: {
        'index.js': 'export default { fetch() { return Response.json(1) } }',
        'asset.bin': { data: new Uint8Array([byte]).buffer },
      },
    })
    compile
      .mockResolvedValueOnce(output(1))
      .mockResolvedValueOnce(output(2))
      .mockResolvedValueOnce(output(3))
    const loader = trackedLoader()
    const agentId = crypto.randomUUID()
    const execute = createCodeExecutor(loader, agentId)
    const source = { code: 'export default () => 1', dependencies: { a: '^1', b: '^2' } }
    await execute(source, allow)
    await execute({ ...source, dependencies: { b: '^2', a: '^1' } }, allow)
    expect(compile).toHaveBeenCalledTimes(1)
    await execute({ ...source, dependencies: { ...source.dependencies, a: '^3' } }, allow)
    // Reopening an agent can resolve the same ranges to a different bundle.
    await createCodeExecutor(loader, agentId)(source, allow)
    expect(compile).toHaveBeenCalledTimes(3)
    expect(new Set(loader.get.mock.calls.map(([id]) => id)).size).toBe(3)
  })
})

it.skipIf(!inject('codeNpmSmoke'))(
  'resolves an npm dependency through createWorker',
  async () => {
    expect(
      await executeCode(
        {
          code: 'import isNumber from "is-number"; export default input => isNumber(input)',
          dependencies: { 'is-number': '7.0.0' },
          input: 42,
        },
        allow,
      ),
    ).toBe('true')
  },
  180_000,
)
