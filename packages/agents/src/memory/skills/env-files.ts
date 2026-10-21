/** Path and file helpers of SkillsEnv: in-memory readers and read-only failures. */
import { err, FileError, LineScanner, ok } from '@earendil-works/pi-durable/env'
import type { BinaryReader, FileInfo, LineScan, Result } from '@earendil-works/pi-durable/env'

export const ROOT = '/skills'

export function notSupported<T>(what: string): Promise<Result<T, FileError>> {
  return Promise.resolve(err(new FileError('not_supported', `Skills are read-only: ${what}`)))
}

export function notFound<T>(path: string): Result<T, FileError> {
  return err(new FileError('not_found', `No such skill file: ${path}`, path))
}

/** Resolve `.` and `..` against `cwd`; never above the root. */
export function normalize(path: string, cwd: string): string {
  const parts: string[] = []
  for (const part of (path.startsWith('/') ? path : `${cwd}/${path}`).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}

export class MemoryReader implements BinaryReader {
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
