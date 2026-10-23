/**
 * The bearer token shared by the local Worker and the CLI, kept under `.cloudflare/`.
 *
 * @module
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { URL } from 'node:url'

/** Where the local token is stored. */
export const tokenPath = new URL('../.cloudflare/cli-token', import.meta.url)

/** Create a new token and store it, readable only by the owner. */
export function createLocalToken(): string {
  const token = randomUUID()
  mkdirSync(new URL('.', tokenPath), { recursive: true })
  writeFileSync(tokenPath, token, { mode: 0o600 })
  return token
}

/**
 * The stored token.
 *
 * @throws {@link Error} When the local Worker has not created one yet.
 */
export function readLocalToken(): string {
  try {
    return readFileSync(tokenPath, 'utf8').trim()
  } catch {
    throw new Error('Start the local Worker first: nr dev:agents')
  }
}
