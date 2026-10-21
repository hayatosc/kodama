/**
 * The dependency rule of src/ (docs/agents.md, Dependencies): each layer imports only itself and
 * the layers listed for it, so lower layers never reach up. Vite bundles the sources as text.
 */
import { expect, it } from 'vitest'

const globbed: Record<string, string> = import.meta.glob(['./**/*.ts', '../drizzle/**/*.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** Source text by path relative to the package, such as `src/agent/agent.ts`. */
const sources = new Map(
  Object.entries(globbed).map(([key, text]) => [
    key.startsWith('../') ? key.slice(3) : `src/${key.slice(2)}`,
    text,
  ]),
)

type Layer =
  | 'lib'
  | 'contracts'
  | 'settings'
  | 'storage'
  | 'memory-store'
  | 'memory'
  | 'agent'
  | 'memory-agent'
  | 'entrypoint'
  | 'helper'

/** The layer of a file, by its path relative to the package. */
function layerOf(path: string): Layer | undefined {
  if (path.startsWith('src/lib/')) return 'lib'
  if (['src/env.ts', 'src/protocol.ts', 'src/validation.ts'].includes(path)) return 'contracts'
  if (/^src\/(configuration|models|prompts|tools)\//.test(path)) return 'settings'
  if (path.startsWith('src/storage/') || path.startsWith('drizzle/')) return 'storage'
  if (path.startsWith('src/memory/store/')) return 'memory-store'
  if (path.startsWith('src/memory/memory-agent/')) return 'memory-agent'
  if (path.startsWith('src/memory/')) return 'memory'
  if (path.startsWith('src/agent/')) return 'agent'
  if (path === 'src/index.ts') return 'entrypoint'
  if (path.startsWith('src/helper/')) return 'helper'
  return undefined
}

/** What each layer may import besides itself. */
const ALLOWED: Record<Layer, readonly Layer[]> = {
  lib: [],
  contracts: ['lib'],
  settings: ['lib', 'contracts'],
  storage: ['lib'],
  'memory-store': ['lib', 'storage'],
  memory: ['lib', 'contracts', 'storage', 'memory-store'],
  agent: ['lib', 'contracts', 'settings', 'storage', 'memory-store', 'memory'],
  'memory-agent': ['lib', 'contracts', 'settings', 'storage', 'memory-store', 'memory', 'agent'],
  entrypoint: ['lib', 'contracts', 'agent', 'memory', 'memory-agent'],
  helper: [
    'lib',
    'contracts',
    'settings',
    'storage',
    'memory-store',
    'memory',
    'agent',
    'memory-agent',
  ],
}

/** `specifier` resolved against the folder of `path`, both relative to the package. */
function resolvePath(path: string, specifier: string): string {
  const parts = path.split('/').slice(0, -1)
  for (const part of specifier.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.') parts.push(part)
  }
  return parts.join('/')
}

/** Relative imports of a file, as paths relative to the package. */
function importsOf(path: string, text: string): string[] {
  return [...text.matchAll(/(?:from|import)\s+['"](\.{1,2}\/[^'"?]+)/g)].flatMap((match) => {
    const specifier = match[1]
    return specifier === undefined ? [] : [resolvePath(path, specifier)]
  })
}

it('places every source file in a layer', () => {
  const unplaced = [...sources.keys()].filter(
    (path) => path.startsWith('src/') && !path.endsWith('.test.ts') && layerOf(path) === undefined,
  )
  expect(unplaced).toEqual([])
})

it('lets each layer import only itself and the layers below it', () => {
  expect(sources.size).toBeGreaterThan(50)
  const violations: string[] = []
  for (const [path, text] of sources) {
    const from = layerOf(path)
    if (from === undefined) continue
    const isTest = path.endsWith('.test.ts')
    for (const target of importsOf(path, text)) {
      const to = layerOf(target)
      if (to === undefined || to === from) continue
      // Tests may use anything, including the helpers in src/helper/.
      if (isTest) continue
      if (!ALLOWED[from].includes(to)) violations.push(`${path} (${from}) -> ${target} (${to})`)
    }
  }
  expect(violations).toEqual([])
})
