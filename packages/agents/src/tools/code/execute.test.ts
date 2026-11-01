/** Dynamic Worker execution, agent-scoped caching and optional real npm compilation. @module */
import { env } from 'cloudflare:workers'
import * as bundler from '@cloudflare/worker-bundler'
import { afterEach, beforeEach, describe, expect, inject, it, vi } from 'vitest'
import { createCodeExecutor, createCodeTool } from './execute.ts'

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
