/**
 * The local agent CLI: `nr agent seed|send|snapshot|cancel`.
 *
 * @see docs/agents.md — Local agent CLI
 *
 * @module
 */
import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'
import { parseAgentRef, parseMessage } from '../src/validation.ts'
import { readLocalToken } from './token.ts'
import { printStream } from './stream.ts'

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      'request-id': { type: 'string' },
      steer: { type: 'boolean' },
      events: { type: 'boolean' },
    },
  })
  if (values.help || positionals.length === 0) {
    console.log(`Usage:
  nr agent seed
  nr agent send <agent> "message" [--request-id ID] [--steer] [--events]
  nr agent snapshot <agent>
  nr agent cancel <agent>

Start nr dev:agents in another terminal first (localhost:5173).
<agent> is a UUID, a slug, or a unique UUID prefix; the seed creates the
first agent, slug assistant, and the first send runs the seed if needed.
The same agent continues its conversation. --events prints JSON events.
Retry with the same request ID and content to avoid duplicate input.
Ctrl+C disconnects; use cancel to stop the agent's work.`)
    return
  }
  const [action, rawAgentRef, content] = positionals
  if (action !== 'seed' && action !== 'send' && action !== 'snapshot' && action !== 'cancel') {
    throw new Error('Expected seed, send, snapshot, or cancel; see nr agent --help')
  }
  const agentId = action === 'seed' ? '' : parseAgentRef(rawAgentRef)
  const expected = action === 'send' ? 3 : action === 'seed' ? 1 : 2
  if (positionals.length !== expected) {
    throw new Error('Unexpected arguments; quote the message and see nr agent --help')
  }
  const message = {
    requestId: values['request-id'] ?? randomUUID(),
    content,
    whenBusy: values.steer ? 'steer' : 'followUp',
  }
  if (action === 'send') parseMessage(message)
  const token = readLocalToken()
  if (action === 'send') console.error(`agent=${agentId} requestId=${message.requestId}`)
  let response: Response
  try {
    const path = action === 'seed' ? 'seed' : `${action}/${agentId}`
    response = await fetch(`http://127.0.0.1:5173/cli/${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: action === 'send' ? JSON.stringify(message) : undefined,
      redirect: 'error',
    })
  } catch (error) {
    throw new Error('Cannot reach the local Worker. Start nr dev:agents first.', { cause: error })
  }
  if (!response.ok) throw new Error(`RPC failed (${response.status}): ${await response.text()}`)
  if (action !== 'send') {
    console.log(JSON.stringify(await response.json(), null, 2))
    return
  }
  if (!response.body) throw new Error('Missing agent response stream')
  await printStream(
    response.body,
    (text) => {
      process.stdout.write(text)
    },
    values.events,
  )
  console.error(`Completed. History: nr agent snapshot ${agentId}`)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
