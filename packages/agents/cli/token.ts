import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { URL } from 'node:url'

export const tokenPath = new URL('../.cloudflare/cli-token', import.meta.url)

export function createLocalToken(): string {
  const token = randomUUID()
  mkdirSync(new URL('.', tokenPath), { recursive: true })
  writeFileSync(tokenPath, token, { mode: 0o600 })
  return token
}

export function readLocalToken(): string {
  try {
    return readFileSync(tokenPath, 'utf8').trim()
  } catch {
    throw new Error('Start the local Worker first: nr dev:agents')
  }
}
