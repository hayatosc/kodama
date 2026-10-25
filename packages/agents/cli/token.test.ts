/**
 * Local CLI credentials round-trip with owner-only permissions and actionable failures.
 *
 * @module
 */
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, type URL } from 'node:url'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createLocalToken, readLocalToken } from './token.ts'

let directory: string
let path: URL

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'kodama-token-'))
  path = pathToFileURL(join(directory, 'nested', 'cli-token'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

it('creates the directory and reads back an owner-only token', () => {
  const token = createLocalToken(path)
  expect(token).toMatch(/^[0-9a-f-]{36}$/)
  expect(readLocalToken(path)).toBe(token)
  expect(statSync(path).mode & 0o777).toBe(0o600)
})

it('rotates the token and restricts an existing file with loose permissions', () => {
  const previous = createLocalToken(path)
  chmodSync(path, 0o644)
  const token = createLocalToken(path)
  expect(token).not.toBe(previous)
  expect(readLocalToken(path)).toBe(token)
  expect(statSync(path).mode & 0o777).toBe(0o600)
})

it('asks to start the local Worker when no token exists yet', () => {
  expect(() => readLocalToken(path)).toThrow('Start the local Worker first: nr dev:agents')
})

it('rejects an empty token rather than sending an empty bearer credential', () => {
  createLocalToken(path)
  writeFileSync(path, ' \n')
  expect(() => readLocalToken(path)).toThrow('Start the local Worker first: nr dev:agents')
})
