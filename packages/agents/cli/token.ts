/**
 * The bearer token shared by the local Worker and the CLI, kept under `.cloudflare/`.
 *
 * @module
 */
import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { URL } from 'node:url'

/** Where the local token is stored. */
export const tokenPath = new URL('../.cloudflare/cli-token', import.meta.url)

/** Create a new token and store it at `path`, readable only by the owner. */
export function createLocalToken(path: URL = tokenPath): string {
  const token = randomUUID()
  mkdirSync(new URL('.', path), { recursive: true })
  writeFileSync(path, token, { mode: 0o600 })
  // The write mode only applies when the file is first created.
  chmodSync(path, 0o600)
  return token
}

/**
 * The stored token.
 *
 * @throws {@link Error} When the local Worker has not created one yet.
 */
export function readLocalToken(path: URL = tokenPath): string {
  try {
    const token = readFileSync(path, 'utf8').trim()
    if (!token) throw new Error('Empty CLI token')
    return token
  } catch {
    throw new Error('Start the local Worker first: nr dev:agents')
  }
}
