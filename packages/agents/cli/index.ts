/**
 * The local agent CLI: `nr agent seed|send|snapshot|cancel`.
 *
 * @see docs/agents.md — Local agent CLI
 *
 * @module
 */
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { CLI_OPTIONS, commandRequest, toCommand, USAGE } from './command.ts'
import { readLocalToken } from './token.ts'
import { printStream } from './stream.ts'

async function main(): Promise<void> {
  const command = toCommand(parseArgs({ allowPositionals: true, options: CLI_OPTIONS }))
  if (command.action === 'help') {
    console.log(USAGE)
    return
  }
  const token = readLocalToken()
  if (command.action === 'send') {
    console.error(`agent=${command.agentRef} requestId=${command.message.requestId}`)
  }
  let response: Response
  try {
    const { url, init } = commandRequest(
      command,
      token,
      command.action === 'dev/seed-credentials' ? readFileSync(0, 'utf8') : undefined,
    )
    response = await fetch(url, init)
  } catch (error) {
    throw new Error('Cannot reach the local Worker. Start nr dev:agents first.', { cause: error })
  }
  if (!response.ok) throw new Error(`RPC failed (${response.status}): ${await response.text()}`)
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
