/**
 * Local agent management, authentication and streamed conversation through the dev-only adapter.
 *
 * @see docs/agents.md — Local agent CLI
 *
 * @module
 */
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { MAX_ARTIFACT_BYTES } from '../src/extensions.ts'
import { parseArgs } from 'node:util'
import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { text } from 'node:stream/consumers'
import { apiKeyRegistration, loginRegistration } from '../src/credentials/local-login.ts'
import { CLI_OPTIONS, commandRequest, toCommand, USAGE } from './command.ts'
import { readLocalToken } from './token.ts'
import { printStream } from './stream.ts'

async function main(): Promise<void> {
  let args
  try {
    args = parseArgs({ allowPositionals: true, options: CLI_OPTIONS })
  } catch {
    throw new Error('Invalid arguments. See nr agent --help; never pass credentials as arguments.')
  }
  const command = toCommand(args)
  if (command.action === 'help') {
    console.log(USAGE)
    return
  }
  const token = readLocalToken()
  if (command.action === 'send') {
    console.error(`agent=${command.agentRef} requestId=${command.message.requestId}`)
  }
  let credentialJson: string | undefined
  if (command.action === 'credentials/add') {
    if (!command.keyFromEnv && process.stdin.isTTY)
      throw new Error(
        'Pipe the key on stdin or use --key-from-env; interactive key input is disabled.',
      )
    credentialJson = apiKeyRegistration(
      command.provider,
      command.requestId,
      command.keyFromEnv ? (process.env[command.keyFromEnv] ?? '') : await text(process.stdin),
    )
  }
  if (command.action === 'credentials/login') {
    const identityRequest = commandRequest({ action: 'credentials/installation' }, token)
    const identity = await fetch(identityRequest.url, identityRequest.init)
    if (!identity.ok)
      throw new Error('Cannot initialize the local installation; start nr dev:agents first.')
    const seed: unknown = await identity.json()
    if (
      typeof seed !== 'object' ||
      seed === null ||
      !('installId' in seed) ||
      typeof seed.installId !== 'string'
    )
      throw new Error('Invalid local installation response')
    const abort = new AbortController()
    const cancel = () => abort.abort()
    process.once('SIGINT', cancel)
    try {
      credentialJson = await loginRegistration(seed.installId, command.requestId, {
        signal: abort.signal,
        notify(event) {
          if (event.type === 'auth_url') console.error(`Open in your browser: ${event.url}`)
        },
        async prompt(prompt) {
          if (prompt.type !== 'manual_code') throw new Error('Unsupported login prompt')
          console.error('Paste the final redirect URL (input is hidden):')
          const reader = createInterface({
            input: process.stdin,
            output: new Writable({
              write(_chunk, _encoding, callback) {
                callback()
              },
            }),
            terminal: process.stdin.isTTY,
          })
          reader.once('SIGINT', cancel)
          try {
            return await reader.question('', { signal: prompt.signal })
          } finally {
            reader.close()
          }
        },
      })
    } finally {
      process.off('SIGINT', cancel)
    }
  }
  let artifact: { filename: string; bytes: Uint8Array } | undefined
  if (command.action === 'artifact-upload') {
    try {
      const stat = statSync(command.path)
      if (!stat.isFile() || stat.size > MAX_ARTIFACT_BYTES)
        throw new Error('Upload must be a file of at most 10 MiB')
      const bytes = readFileSync(command.path)
      if (bytes.byteLength > MAX_ARTIFACT_BYTES) throw new Error('Upload exceeds 10 MiB')
      artifact = { filename: basename(command.path), bytes }
    } catch (error) {
      throw new Error(
        'Cannot upload file. Choose a readable regular file of at most 10 MiB. See nr agent --help.',
        { cause: error },
      )
    }
  }
  let response: Response
  try {
    const { url, init } = commandRequest(
      command,
      token,
      command.action === 'dev/seed-credentials' ? await text(process.stdin) : credentialJson,
      artifact,
    )
    response = await fetch(url, init)
  } catch (error) {
    throw new Error('Cannot reach the local Worker. Start nr dev:agents first.', { cause: error })
  }
  if (!response.ok) {
    if (command.action.startsWith('credentials/') || command.action === 'dev/seed-credentials')
      throw new Error(
        `Credential operation failed (${response.status}); check the local Worker, KEK and input.`,
      )
    throw new Error(`RPC failed (${response.status}): ${await response.text()}`)
  }
  if (command.action === 'artifact-download') {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > MAX_ARTIFACT_BYTES) throw new Error('Download exceeds 10 MiB')
    writeFileSync(command.path, bytes, { flag: 'wx', mode: 0o600 })
    console.log(`Saved ${bytes.byteLength} bytes to ${command.path}`)
    return
  }
  if (command.action !== 'send') {
    console.log(JSON.stringify(await response.json(), null, 2))
    return
  }
  if (!response.body) throw new Error('Missing agent response stream')
  await printStream(
    response.body,
    (text) => {
      process.stdout.write(text)
    },
    command.events,
  )
  console.error(`Completed. History: nr agent snapshot ${command.agentRef}`)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
