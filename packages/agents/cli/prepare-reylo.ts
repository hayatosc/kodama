/**
 * Builds the combined local SQLite database used by Reylo for static typechecking (`.reylo/typecheck.sqlite`)
 * and emits matching `.d.sql.ts` declaration mirrors under `.reylo/types/` so type-aware Oxlint
 * resolves `.sql` imports identically to TypeScript's content mapper.
 *
 * @module
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import * as v from 'valibot'

const packageRoot = resolve(import.meta.dirname, '..')
const reyloDir = join(packageRoot, '.reylo')
const dbPath = join(reyloDir, 'typecheck.sqlite')
const schemaHashPath = join(reyloDir, 'schema.sha256')
const typesRoot = join(reyloDir, 'types')

const mapperResultSchema = v.object({
  text: v.string(),
  diagnostics: v.array(
    v.object({
      messageText: v.string(),
      start: v.optional(v.number()),
      length: v.optional(v.number()),
      code: v.optional(v.number()),
    }),
  ),
})

interface MapperHandlers {
  initialize(params: Record<string, unknown>): Promise<unknown>
  openProject(params: { projectHandle: string; configFileName: string }): Promise<unknown>
  transform(params: { projectHandle: string; fileName: string; content: string }): Promise<unknown>
  closeProject(params: { projectHandle: string }): Promise<unknown>
}

function isMapperHandlers(value: unknown): value is MapperHandlers {
  return (
    typeof value === 'object' &&
    value !== null &&
    'initialize' in value &&
    typeof value.initialize === 'function' &&
    'openProject' in value &&
    typeof value.openProject === 'function' &&
    'transform' in value &&
    typeof value.transform === 'function' &&
    'closeProject' in value &&
    typeof value.closeProject === 'function'
  )
}

function listSqlFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listSqlFiles(full))
    else if (entry.isFile() && entry.name.endsWith('.sql')) out.push(full)
  }
  return out.sort()
}

function loadSchemaStatements(): { combined: string; hash: string } {
  const sources = [
    ...listSqlFiles(join(packageRoot, 'sql/memory/migrations')),
    ...listSqlFiles(join(packageRoot, 'sql/management/migrations')),
    ...listSqlFiles(join(packageRoot, 'sql/durable-object/migrations')),
    join(packageRoot, 'sql/pi-tables.sql'),
  ]
  const chunks = sources.map((file) => readFileSync(file, 'utf8'))
  const combined = chunks.join('\n;\n')
  const hash = createHash('sha256').update(combined).digest('hex')
  return { combined, hash }
}

function rebuildTypecheckDb(): boolean {
  mkdirSync(reyloDir, { recursive: true })
  const { combined, hash } = loadSchemaStatements()
  const existingHash = existsSync(schemaHashPath) ? readFileSync(schemaHashPath, 'utf8') : undefined
  if (existsSync(dbPath) && existingHash === hash) return false

  rmSync(dbPath, { force: true })
  const db = new DatabaseSync(dbPath)
  try {
    db.exec(combined)
  } finally {
    db.close()
  }
  writeFileSync(schemaHashPath, hash, 'utf8')
  return true
}

interface ToolingModule {
  mapperHandlers(): unknown
  releaseConnections?: () => Promise<unknown>
}

function loadReyloTooling(): { handlers: MapperHandlers; release?: () => Promise<unknown> } {
  const req = createRequire(join(packageRoot, 'package.json'))
  const requireModule: (id: string) => unknown = req
  const toolingPath = join(dirname(req.resolve('reylo/vite')), 'tooling.js')
  const rawModule = requireModule(toolingPath)
  const mod =
    typeof rawModule === 'object' && rawModule !== null && 'default' in rawModule
      ? rawModule.default
      : rawModule
  if (
    typeof mod !== 'object' ||
    mod === null ||
    !('mapperHandlers' in mod) ||
    typeof mod.mapperHandlers !== 'function'
  ) {
    throw new TypeError('Unexpected reylo tooling module shape')
  }
  const { mapperHandlers } = mod
  const releaseConnections =
    'releaseConnections' in mod && typeof mod.releaseConnections === 'function'
      ? mod.releaseConnections
      : undefined
  const typedMod: ToolingModule = {
    mapperHandlers: () => mapperHandlers(),
    ...(releaseConnections
      ? {
          releaseConnections: async () => {
            await releaseConnections()
          },
        }
      : {}),
  }
  const handlers: unknown = typedMod.mapperHandlers()
  if (!isMapperHandlers(handlers)) {
    throw new TypeError('Unexpected reylo mapperHandlers shape')
  }
  return {
    handlers,
    ...(typedMod.releaseConnections ? { release: typedMod.releaseConnections } : {}),
  }
}

function declarationPathFor(sqlFile: string): string {
  const rel = relative(packageRoot, sqlFile)
  const withoutExt = rel.slice(0, -'.sql'.length)
  return join(typesRoot, `${withoutExt}.d.sql.ts`)
}

/**
 * Rebuild `.reylo/typecheck.sqlite` when schemas change and emit `.d.sql.ts` mirrors for all
 * `.sql` query files under `src/` and `cli/`.
 */
export async function prepareReylo(): Promise<void> {
  const schemaChanged = rebuildTypecheckDb()
  const queryFiles = [
    ...listSqlFiles(join(packageRoot, 'src')),
    ...listSqlFiles(join(packageRoot, 'cli')),
  ]
  if (schemaChanged) {
    rmSync(join(reyloDir, 'queries'), { recursive: true, force: true })
  }
  rmSync(typesRoot, { recursive: true, force: true })
  mkdirSync(typesRoot, { recursive: true })

  if (queryFiles.length === 0) return

  const { handlers, release } = loadReyloTooling()
  const projectHandle = 'prepare-reylo'
  await handlers.initialize({})
  await handlers.openProject({
    projectHandle,
    configFileName: resolve(packageRoot, 'tsconfig.json'),
  })
  try {
    const errors: string[] = []
    for (const file of queryFiles) {
      const content = readFileSync(file, 'utf8')
      const raw = await handlers.transform({ projectHandle, fileName: file, content })
      const parsed = v.parse(mapperResultSchema, raw)
      for (const diag of parsed.diagnostics) {
        errors.push(`${relative(packageRoot, file)}: ${diag.messageText}`)
      }
      const target = declarationPathFor(file)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, parsed.text, 'utf8')
    }
    if (errors.length > 0) {
      throw new Error(`Reylo SQL errors:\n${errors.join('\n')}`)
    }
  } finally {
    await handlers.closeProject({ projectHandle })
    await release?.()
  }
}

if (import.meta.main) await prepareReylo()
