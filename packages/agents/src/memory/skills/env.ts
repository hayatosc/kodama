/**
 * A read-only execution environment over the skills an agent sees, for Pi's `read` tool
 * (docs/design/long-term-memory.md, Listing and loading). Paths are `/skills/<scope>/<name>/...`;
 * anything else, and every write or command, fails.
 */
import type { Context } from '@earendil-works/chord'
import { err, ExecutionError, FileError, LineScanner, ok } from '@earendil-works/pi-durable/env'
import type {
  BinaryReader,
  DirReader,
  ExecutionEnv,
  FileInfo,
  FileWatcher,
  LineScan,
  Result,
  ShellExecResult,
  TextLineReader,
} from '@earendil-works/pi-durable/env'
import type { VisibleSkill } from './paths.ts'
import { skillDir } from './paths.ts'

const ROOT = '/skills'

function notSupported<T>(what: string): Promise<Result<T, FileError>> {
  return Promise.resolve(err(new FileError('not_supported', `Skills are read-only: ${what}`)))
}

function notFound<T>(path: string): Result<T, FileError> {
  return err(new FileError('not_found', `No such skill file: ${path}`, path))
}

/** Resolve `.` and `..` against `cwd`; never above the root. */
function normalize(path: string, cwd: string): string {
  const parts: string[] = []
  for (const part of (path.startsWith('/') ? path : `${cwd}/${path}`).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}

class MemoryReader implements BinaryReader {
  readonly #bytes: Uint8Array
  readonly #info: FileInfo

  constructor(bytes: Uint8Array, info: FileInfo) {
    this.#bytes = bytes
    this.#info = info
  }

  info(): Promise<Result<FileInfo, FileError>> {
    return Promise.resolve(ok(this.#info))
  }

  read(offset: number, length: number): Promise<Result<Uint8Array, FileError>> {
    return Promise.resolve(ok(this.#bytes.slice(offset, offset + length)))
  }

  scanLines(options: {
    startLine: number
    endLine?: number
  }): Promise<Result<LineScan, FileError>> {
    const scanner = new LineScanner(options.startLine, options.endLine)
    scanner.push(this.#bytes)
    return Promise.resolve(ok(scanner.finish()))
  }

  close(): Promise<void> {
    return Promise.resolve()
  }
}

export class SkillsEnv implements ExecutionEnv {
  readonly id = 'kodama-skills'
  cwd = ROOT
  readonly #bucket: R2Bucket
  /** `/skills/<scope>/<name>` of each visible skill. */
  readonly #dirs: Set<string>

  constructor(bucket: R2Bucket, visible: readonly VisibleSkill[]) {
    this.#bucket = bucket
    this.#dirs = new Set(
      visible.map((skill) => `/${skillDir(skill.scope, skill.name).slice(0, -1)}`),
    )
  }

  /** The R2 key of a file in a visible skill, or undefined. */
  #key(path: string): string | undefined {
    const absolute = normalize(path, this.cwd)
    const [, root, scope, name, ...rest] = absolute.split('/')
    if (root !== 'skills' || scope === undefined || name === undefined || rest.length === 0) return
    if (!this.#dirs.has(`/skills/${scope}/${name}`)) return
    return `skills/${scope}/${name}/${rest.join('/')}`
  }

  #isDirectory(path: string): boolean {
    const absolute = normalize(path, this.cwd)
    if (absolute === ROOT || this.#dirs.has(absolute)) return true
    // `/skills` and each scope above a visible skill; folders inside a skill are not listed here.
    return [...this.#dirs].some((dir) => dir.startsWith(`${absolute}/`))
  }

  async #object(path: string): Promise<{ bytes: Uint8Array; info: FileInfo } | undefined> {
    const key = this.#key(path)
    if (key === undefined) return undefined
    const object = await this.#bucket.get(key)
    if (object === null) return undefined
    const bytes = new Uint8Array(await object.arrayBuffer())
    const absolute = normalize(path, this.cwd)
    return {
      bytes,
      info: {
        name: absolute.slice(absolute.lastIndexOf('/') + 1),
        path: absolute,
        kind: 'file',
        size: bytes.byteLength,
        mtimeMs: object.uploaded.getTime(),
      },
    }
  }

  absolutePath(path: string): Promise<Result<string, FileError>> {
    return Promise.resolve(ok(normalize(path, this.cwd)))
  }

  canonicalPath(path: string): Promise<Result<string, FileError>> {
    return this.absolutePath(path)
  }

  joinPath(parts: string[]): Promise<Result<string, FileError>> {
    return Promise.resolve(ok(normalize(parts.join('/'), this.cwd)))
  }

  async exists(path: string): Promise<Result<boolean, FileError>> {
    if (this.#isDirectory(path)) return ok(true)
    const key = this.#key(path)
    return ok(key !== undefined && (await this.#bucket.head(key)) !== null)
  }

  async fileInfo(path: string): Promise<Result<FileInfo, FileError>> {
    if (this.#isDirectory(path)) {
      const absolute = normalize(path, this.cwd)
      const name = absolute.slice(absolute.lastIndexOf('/') + 1)
      return ok({ name, path: absolute, kind: 'directory', size: 0, mtimeMs: 0 })
    }
    const file = await this.#object(path)
    return file === undefined ? notFound(path) : ok(file.info)
  }

  async openBinaryReader(path: string): Promise<Result<BinaryReader, FileError>> {
    if (this.#isDirectory(path))
      return err(new FileError('is_directory', `${path} is a directory`, path))
    const file = await this.#object(path)
    return file === undefined ? notFound(path) : ok(new MemoryReader(file.bytes, file.info))
  }

  async readBinaryFile(path: string): Promise<Result<Uint8Array, FileError>> {
    const file = await this.#object(path)
    return file === undefined ? notFound(path) : ok(file.bytes)
  }

  async readTextFile(path: string): Promise<Result<string, FileError>> {
    const file = await this.#object(path)
    return file === undefined ? notFound(path) : ok(new TextDecoder().decode(file.bytes))
  }

  async readTextLines(
    path: string,
    options: { maxLines?: number } | undefined,
  ): Promise<Result<string[], FileError>> {
    const text = await this.readTextFile(path)
    if (!text.ok) return text
    const lines = text.value.split('\n')
    return ok(options?.maxLines === undefined ? lines : lines.slice(0, options.maxLines))
  }

  async openTextLineReader(path: string): Promise<Result<TextLineReader, FileError>> {
    const text = await this.readTextFile(path)
    if (!text.ok) return text
    const lines = text.value.split('\n')
    const last = lines.length - 1
    let index = 0
    return ok({
      readLine: (_context: Context) => {
        if (index > last || (index === last && lines[index] === ''))
          return Promise.resolve(ok(undefined))
        const line = lines[index] ?? ''
        const terminated = index < last
        index++
        return Promise.resolve(ok({ text: line, terminated }))
      },
      close: () => Promise.resolve(),
    })
  }

  async listDir(path: string): Promise<Result<FileInfo[], FileError>> {
    const absolute = normalize(path, this.cwd)
    if (!this.#isDirectory(absolute)) return notFound(path)
    const entries = new Map<string, FileInfo>()
    for (const dir of this.#dirs) {
      if (!dir.startsWith(`${absolute}/`)) continue
      const name = dir.slice(absolute.length + 1).split('/')[0] ?? ''
      entries.set(name, {
        name,
        path: `${absolute}/${name}`,
        kind: 'directory',
        size: 0,
        mtimeMs: 0,
      })
    }
    if (entries.size === 0) {
      const prefix = `${absolute.slice(1)}/`
      const page = await this.#bucket.list({ prefix, delimiter: '/' })
      for (const object of page.objects) {
        const name = object.key.slice(prefix.length)
        const info: FileInfo = {
          name,
          path: `${absolute}/${name}`,
          kind: 'file',
          size: object.size,
          mtimeMs: object.uploaded.getTime(),
        }
        entries.set(name, info)
      }
      for (const sub of page.delimitedPrefixes) {
        const name = sub.slice(prefix.length, -1)
        entries.set(name, {
          name,
          path: `${absolute}/${name}`,
          kind: 'directory',
          size: 0,
          mtimeMs: 0,
        })
      }
    }
    return ok([...entries.values()])
  }

  async openDirReader(path: string): Promise<Result<DirReader, FileError>> {
    const listed = await this.listDir(path)
    if (!listed.ok) return listed
    let done = false
    return ok({
      next: () => {
        const entries = done ? [] : listed.value
        done = true
        return Promise.resolve(ok({ entries, done: true }))
      },
      close: () => Promise.resolve(),
    })
  }

  writeFile(): Promise<Result<void, FileError>> {
    return notSupported('write')
  }

  appendFile(): Promise<Result<void, FileError>> {
    return notSupported('append')
  }

  truncateFile(): Promise<Result<void, FileError>> {
    return notSupported('truncate')
  }

  flushFile(): Promise<Result<void, FileError>> {
    return notSupported('flush')
  }

  renameFile(): Promise<Result<void, FileError>> {
    return notSupported('rename')
  }

  createDir(): Promise<Result<void, FileError>> {
    return notSupported('create a directory')
  }

  remove(): Promise<Result<void, FileError>> {
    return notSupported('remove')
  }

  createTempDir(): Promise<Result<string, FileError>> {
    return notSupported('create a temporary directory')
  }

  createTempFile(): Promise<Result<string, FileError>> {
    return notSupported('create a temporary file')
  }

  watch(): Promise<Result<FileWatcher, FileError>> {
    return notSupported('watch')
  }

  exec(): Promise<Result<ShellExecResult, ExecutionError>> {
    return Promise.resolve(
      err(new ExecutionError('shell_unavailable', 'Skill scripts cannot run here')),
    )
  }

  cleanup(): Promise<void> {
    return Promise.resolve()
  }
}
