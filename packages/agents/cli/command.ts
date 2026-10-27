/**
 * The local agent CLI's parsed arguments as a command, and the request each command sends to the
 * local Worker. Parsing stays in `index.ts`, since workerd has no `parseArgs`.
 *
 * @see docs/agents.md — Local agent CLI
 *
 * @module
 */
import { uuidv7 } from '../src/lib/uuid.ts'
import type { CreateAgentRequest, SendMessageRequest } from '../src/protocol.ts'
import { parseAgentId, parseAgentRef, parseMessage } from '../src/validation.ts'

/** Where the local Worker listens. */
export const LOCAL_WORKER_URL = 'http://127.0.0.1:5173'

/** The help text. */
export const USAGE = `Usage:
  nr agent dev seed-credentials < /secure/path/provider-keys.json
  nr agent seed
  nr agent list
  nr agent create <slug> [--name NAME]
  nr agent credentials add --provider openai [--key-from-env ENV_NAME]
  nr agent credentials login --provider openai
  nr agent credentials list
  nr agent credentials assign <credential-id> <agent>
  nr agent credentials unassign <credential-id> <agent>
  nr agent credentials revoke <credential-id>
  nr agent send <agent> "message" [--request-id ID] [--steer] [--events]
  nr agent snapshot <agent>
  nr agent cancel <agent>

Start nr dev:agents in another terminal first (localhost:5173).
<agent> is a UUID, a slug, or a unique UUID prefix; the seed creates the
first agent, slug assistant, and the first send runs the seed if needed.
The same agent continues its conversation. --events prints JSON events.
Retry with the same request ID and content to avoid duplicate input.
Ctrl+C disconnects; use cancel to stop the agent's work.
Credentials add reads the key from stdin when --key-from-env is absent.
Never pass a key as an argument. Login prints the ChatGPT authorization URL
and accepts a pasted redirect URL without echoing it. Credentials stay in memory
until write-only registration; reads return metadata only. Assign after registration.`

/** One CLI invocation. */
export type Command =
  | { action: 'help' }
  | { action: 'seed' | 'list' | 'credentials/list' }
  | { action: 'create'; request: CreateAgentRequest }
  | { action: 'credentials/add'; provider: string; keyFromEnv?: string; requestId: string }
  | { action: 'credentials/login'; provider: 'openai'; requestId: string }
  | {
      action: 'credentials/assign' | 'credentials/unassign'
      credentialId: string
      agentRef: string
    }
  | { action: 'credentials/revoke'; credentialId: string }
  | { action: 'dev/seed-credentials' }
  | { action: 'snapshot' | 'cancel'; agentRef: string }
  | { action: 'send'; agentRef: string; message: SendMessageRequest; events: boolean }

/** The CLI's options, for `parseArgs` from `node:util`. */
export const CLI_OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  'request-id': { type: 'string' },
  steer: { type: 'boolean' },
  events: { type: 'boolean' },
  name: { type: 'string' },
  provider: { type: 'string' },
  'key-from-env': { type: 'string' },
} as const

/** What `parseArgs` returns for {@link CLI_OPTIONS}. */
export interface ParsedArgs {
  values: {
    help?: boolean
    'request-id'?: string
    steer?: boolean
    events?: boolean
    name?: string
    provider?: string
    'key-from-env'?: string
  }
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
  if (action === 'dev' && rawAgentRef === 'seed-credentials' && positionals.length === 2)
    return { action: 'dev/seed-credentials' }
  if (action === 'list' && positionals.length === 1) return { action }
  if (action === 'create' && positionals.length === 2 && rawAgentRef)
    return {
      action,
      request: {
        requestId: values['request-id'] ?? newRequestId(),
        slug: rawAgentRef,
        displayName: values.name ?? rawAgentRef,
      },
    }
  if (action === 'credentials') {
    if (rawAgentRef === 'list' && positionals.length === 2) return { action: 'credentials/list' }
    if ((rawAgentRef === 'add' || rawAgentRef === 'login') && positionals.length === 2) {
      const provider = values.provider
      if (!provider || !['openai', 'anthropic', 'google', 'xai'].includes(provider))
        throw new Error('Choose a supported provider with --provider')
      const requestId = values['request-id'] ?? newRequestId()
      if (rawAgentRef === 'login') {
        if (provider !== 'openai') throw new Error('ChatGPT login requires --provider openai')
        return { action: 'credentials/login', provider, requestId }
      }
      return {
        action: 'credentials/add',
        provider,
        requestId,
        ...(values['key-from-env'] ? { keyFromEnv: values['key-from-env'] } : {}),
      }
    }
    if (rawAgentRef === 'revoke' && positionals.length === 3)
      return { action: 'credentials/revoke', credentialId: parseAgentId(content) }
    if ((rawAgentRef === 'assign' || rawAgentRef === 'unassign') && positionals.length === 4)
      return {
        action: `credentials/${rawAgentRef}`,
        credentialId: parseAgentId(content),
        agentRef: parseAgentRef(positionals[3]),
      }
    throw new Error('Invalid credential command; see nr agent --help')
  }
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
  credentialJson?: string,
): { url: string; init: RequestInit } {
  const path =
    'credentialId' in command
      ? `${command.action}/${command.credentialId}${'agentRef' in command ? `/${command.agentRef}` : ''}`
      : 'agentRef' in command
        ? `${command.action}/${command.agentRef}`
        : command.action === 'credentials/login'
          ? 'credentials/add'
          : command.action
  return {
    url: `${LOCAL_WORKER_URL}/cli/${path}`,
    init: {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body:
        command.action === 'send'
          ? JSON.stringify(command.message)
          : command.action === 'create'
            ? JSON.stringify(command.request)
            : credentialJson,
      redirect: 'error',
    },
  }
}
