/**
 * The local agent CLI's parsed arguments as a command, and the request each command sends to the
 * local Worker. Parsing stays in `index.ts`, since workerd has no `parseArgs`.
 *
 * @see docs/agents.md — Local agent CLI
 *
 * @module
 */
import { uuidv7 } from '../src/lib/uuid.ts'
import type { SendMessageRequest } from '../src/protocol.ts'
import { parseAgentRef, parseMessage } from '../src/validation.ts'

/** Where the local Worker listens. */
export const LOCAL_WORKER_URL = 'http://127.0.0.1:5173'

/** The help text. */
export const USAGE = `Usage:
  nr agent seed
  nr agent send <agent> "message" [--request-id ID] [--steer] [--events]
  nr agent snapshot <agent>
  nr agent cancel <agent>

Start nr dev:agents in another terminal first (localhost:5173).
<agent> is a UUID, a slug, or a unique UUID prefix; the seed creates the
first agent, slug assistant, and the first send runs the seed if needed.
The same agent continues its conversation. --events prints JSON events.
Retry with the same request ID and content to avoid duplicate input.
Ctrl+C disconnects; use cancel to stop the agent's work.`

/** One CLI invocation. */
export type Command =
  | { action: 'help' }
  | { action: 'seed' }
  | { action: 'snapshot' | 'cancel'; agentRef: string }
  | { action: 'send'; agentRef: string; message: SendMessageRequest; events: boolean }

/** The CLI's options, for `parseArgs` from `node:util`. */
export const CLI_OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  'request-id': { type: 'string' },
  steer: { type: 'boolean' },
  events: { type: 'boolean' },
} as const

/** What `parseArgs` returns for {@link CLI_OPTIONS}. */
export interface ParsedArgs {
  values: { help?: boolean; 'request-id'?: string; steer?: boolean; events?: boolean }
  positionals: string[]
}

/**
 * The command of the parsed arguments.
 *
 * @param newRequestId - Supplies the request ID when `--request-id` is absent.
 * @throws {@link Error} When the action or the number of arguments is wrong.
 * @throws {@link TypeError} When the agent reference or the message is invalid.
 */
export function toCommand(
  { values, positionals }: ParsedArgs,
  newRequestId: () => string = uuidv7,
): Command {
  if (values.help || positionals.length === 0) return { action: 'help' }
  const [action, rawAgentRef, content] = positionals
  if (action !== 'seed' && action !== 'send' && action !== 'snapshot' && action !== 'cancel') {
    throw new Error('Expected seed, send, snapshot, or cancel; see nr agent --help')
  }
  const expected = action === 'send' ? 3 : action === 'seed' ? 1 : 2
  if (positionals.length !== expected) {
    throw new Error('Unexpected arguments; quote the message and see nr agent --help')
  }
  if (action === 'seed') return { action }
  const agentRef = parseAgentRef(rawAgentRef)
  if (action !== 'send') return { action, agentRef }
  const message = parseMessage({
    requestId: values['request-id'] ?? newRequestId(),
    content,
    whenBusy: values.steer ? 'steer' : 'followUp',
  })
  return { action, agentRef, message, events: values.events === true }
}

/** The URL and request that run `command` on the local Worker's CLI adapter. */
export function commandRequest(
  command: Exclude<Command, { action: 'help' }>,
  token: string,
): { url: string; init: RequestInit } {
  const path = command.action === 'seed' ? 'seed' : `${command.action}/${command.agentRef}`
  return {
    url: `${LOCAL_WORKER_URL}/cli/${path}`,
    init: {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: command.action === 'send' ? JSON.stringify(command.message) : undefined,
      redirect: 'error',
    },
  }
}
