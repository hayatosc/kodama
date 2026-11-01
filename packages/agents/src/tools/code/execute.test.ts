/** Dynamic Worker execution, capability isolation and optional real npm compilation. @module */
import { env } from 'cloudflare:workers'
import { describe, expect, inject, it } from 'vitest'
import { createCodeTool, executeCode } from './execute.ts'

declare module 'vitest' {
  interface ProvidedContext {
    /** Opt into real registry requests; normal tests stay offline. */
    codeNpmSmoke: boolean
  }
}

const allow = async () => undefined

describe('executeCode', () => {
  it('runs TypeScript with JSON input and async output', async () => {
    expect(
      await executeCode(
        env.CODE_LOADER,
        {
          code: 'export default async (input: { values: number[] }) => ({ total: input.values.reduce((a, b) => a + b, 0) })',
          input: { values: [20, 22] },
        },
        allow,
      ),
    ).toBe('{"total":42}')
  })

  it('uses null input by default and starts each call in a fresh isolate', async () => {
    for (let i = 0; i < 2; i++) {
      expect(
        await executeCode(
          env.CODE_LOADER,
          {
            code: 'let calls = 0; export default input => ({ input, calls: ++calls })',
          },
          allow,
        ),
      ).toBe('{"input":null,"calls":1}')
    }
  })

  it('exposes no host bindings and blocks outbound fetch', async () => {
    expect(
      await executeCode(
        env.CODE_LOADER,
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

  it('forwards virtual modules to the compiler', async () => {
    expect(
      await executeCode(
        env.CODE_LOADER,
        {
          code: 'import double from "double"; export default () => double(21)',
          virtualModules: { double: 'export default x => x * 2' },
        },
        allow,
      ),
    ).toBe('42')
  })

  it('rejects cancelled calls before compilation', async () => {
    await expect(
      executeCode(env.CODE_LOADER, { code: 'not valid source' }, allow, AbortSignal.abort()),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rechecks cancellation after admission', async () => {
    const controller = new AbortController()
    await expect(
      executeCode(
        env.CODE_LOADER,
        { code: 'not valid source' },
        async () => {
          controller.abort()
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
          env.CODE_LOADER,
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
    await expect(
      executeCode(env.CODE_LOADER, { code: 'export default {' }, allow),
    ).rejects.toThrow()
    await expect(
      executeCode(
        env.CODE_LOADER,
        { code: 'export default () => { throw new Error("program_failed") }' },
        allow,
      ),
    ).rejects.toThrow('program_failed')
  })

  it('marks tool executions unsafe to replay after interruption', () => {
    expect(createCodeTool().replay).toBe('unsafe')
  })
})

it.skipIf(!inject('codeNpmSmoke'))(
  'resolves an npm dependency through createWorker',
  async () => {
    expect(
      await executeCode(
        env.CODE_LOADER,
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
