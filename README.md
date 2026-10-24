# Kodama

Pi Durable agents on Cloudflare Durable Objects, managed with the `cf` CLI.

Each agent has a server-issued UUID, its `agentId`, in a registry in the management D1 database,
and addresses **one agent = one Durable Object**. The object owns its SQLite-backed Pi session,
conversation history, inbox, recovery alarm, and applied configuration version. The seed creates
the first agent, a general-purpose assistant that is also the installation's administrator. Agent orchestration
and model-invoked delegation tools can be added on top of the RPC transport.

```text
packages/
  agents/                 @kodama/agents: RPC Worker and Durable Objects
    cloudflare.config.ts  cf bindings, secrets, Durable Object exports, cron trigger
    drizzle/              Drizzle schemas and their generated migrations, per database
    src/index.ts          Service-binding RPC entrypoint (AgentService)
    src/admin/            AdminService: registry, configuration versions, seed, reconciliation
    src/management/          The management database: registry, admission, versions, lifecycle
    src/lib/              Generic helpers that import nothing else from src/
    src/agent/            Agent Durable Object: RPC, Pi runtime, SSE events, alarms
    src/agent/dedicated/  Agent subclasses under reserved names; memory/ is the memory agent
    src/configuration/    Configuration versions: settings, validation, and the applied parts
    src/models/           Pi provider catalog and Worker credential resolution
    src/tools/            Tool implementations and registration
    src/memory/           Long-term memory: store, tools, pruning, archive, and skills
    src/storage/          Kodama's tables in each Durable Object's SQLite
    src/protocol.ts       Transport data types (safe to import as types in a UI)
    src/helper/           Shared test helpers; tests sit next to their modules as *.test.ts
  ui/                     Planned: web UI and its server Worker
```

## Documentation

- [docs/agents.md](docs/agents.md): the agent runtime, RPC contract, events, development,
  testing, and deployment.
- [docs/memory.md](docs/memory.md): long-term memory, the memory agent, pruning and the archive,
  skills, and shared memory.

## Development

Requires Node.js >=22.19 and pnpm 12.14.0. Commands below use the `ni`/`nr`
wrappers; `packageManager` pins pnpm for the workspace.

```sh
ni
cp packages/agents/.dev.vars.example packages/agents/.dev.vars
# Fill the individual API keys in packages/agents/.dev.vars for the providers you use.
nr dev:agents
```

`cf dev` starts the Vite-powered Worker. There is no browser page. Production
calls use a Worker service binding or DO binding; local CLI access is described below.
The initial model uses `DEFAULT_MODEL_PROVIDER` and `DEFAULT_MODEL_ID` in
`cloudflare.config.ts`. Defaults apply only to new agents. Each agent's configuration is a
sequence of versions in the management database, changed through `AdminService`.

```sh
nr check
cd packages/agents
nr build
nr cf:types
```

Checks cover TypeScript, type-aware Oxlint, Oxfmt, and workerd integration tests.
Tests mock only the external model fetch; RPC, Pi Durable, SQLite, eviction, and
alarms run in the Workers runtime without a real API key.
`cf build` produces `.cloudflare/output/v0/` locally without deploying.
Generated runtime types and local state are ignored by Git.

## Local agent CLI

Configure provider credentials in `packages/agents/.dev.vars`, then start
`nr dev:agents`. In another terminal, run these commands from the repository root:

```sh
nr agent seed
nr agent send assistant "Hello!"
nr agent send assistant "Continue the conversation."
nr agent snapshot assistant
nr agent cancel assistant
```

`seed` creates the administrator agent, slug `assistant`; a `send` to a slug runs it first if
needed. An agent is named by its UUID, its slug, or a unique UUID prefix, and it retains its
conversation in local Durable Object storage.
`send` prints assistant text as it arrives and exits nonzero on model failure or
an interrupted stream. Request IDs appear on stderr. To retry a delivery without
duplicating input, pass the original ID and identical content:

```sh
nr agent send assistant "Hello!" --request-id my-test-1
nr agent send assistant "Change direction." --steer
nr agent send assistant "Hello!" --events
nr agent --help
```

`--events` prints JSON events for debugging. Completed retries display the saved
answer for that request. Use `snapshot` to inspect the conversation. Ctrl+C disconnects the CLI;
use `cancel` to stop work and withdraw queued messages. Automatic provider retries
can keep `send` waiting until recovery or cancellation.

The CLI connects to a token-authenticated adapter at `127.0.0.1:5173`, which calls
the existing Durable Object RPC methods. The adapter is selected only in the
`development` mode. Standard `cf build` / `cf deploy` use the private production
entrypoint. Do not deploy with `--mode development`. An automatically generated
token lives in ignored `.cloudflare/cli-token`; restart the dev server if another
development configuration evaluation replaces it. No additional CLI dependency
or Wrangler installation is needed. This CLI targets local agents, not deployed ones.

## RPC contract

The default `AgentService` Worker exposes:

| Method                                         | Result                                       |
| ---------------------------------------------- | -------------------------------------------- |
| `send(agentId, { requestId, content })`        | SSE response through terminal submission     |
| `subscribe(agentId)`                           | Continuous agent-wide SSE observation        |
| `sendMessage(agentId, { requestId, content })` | Durable acceptance with `submissionId`       |
| `submission(agentId, requestId)`               | Submission status, or `undefined`            |
| `snapshot(agentId)`                            | Committed user/assistant messages and `busy` |
| `cancel(agentId)`                              | Stop current work; resolves once idle        |

Agent IDs are lowercase UUIDs from the registry; an ID that is not registered is rejected
before any Durable Object is created. Request IDs contain 1–128 letters, digits, `_`, or `-`. Messages must be nonblank and at most 16000 characters.
Reuse the same request ID and content to retry a delivery; use a new request ID
for a new turn. Request IDs are scoped to the receiving agent's root conversation.
Input arriving while an agent is busy is queued by Pi Durable. Messages accept an
optional `whenBusy: 'followUp' | 'steer'` in `send`, `sendMessage`, and `Agent.sendTo`.
The default, `followUp`, waits for the current run to answer and starts the next run.
Use `steer` to join the current run after its current tool round, for example:

```ts
await env.AGENT_SERVICE.sendMessage(agentId, {
  requestId: crypto.randomUUID(),
  content: 'Prioritize the failing tests.',
  whenBusy: 'steer',
})
```

Neither mode interrupts an executing tool. When idle, both start a run immediately.

For chat, use `send()` to submit input and receive its streaming response in one RPC.
Use `subscribe()` for continuous agent-wide observation.
For one-off status checks, call `submission()` until it settles. `done` means an answer was committed;
`unanswered` means generation did not produce an answer; its `reason` (for example
`model_error`) and text `detail` (such as the provider error message) say why. Other
Pi submission states are preserved in the typed result. Read `snapshot()` to display messages.
`snapshot()` returns committed text; `subscribe()` also streams in-flight generation
and tool execution events.

Like opencode, transient provider failures (rate limits, 5xx, request timeouts after
5 minutes, dropped connections) do not fail a turn: the agent waits and retries
without an attempt limit, backing off from 2 to at most 30 seconds. The wait is
durable and survives object eviction. Non-retryable errors such as invalid
credentials or exhausted quota settle the turn as `unanswered`.

`cancel(agentId)` is the way out of a long retry or an unwanted run, like pressing
Esc in opencode. It stops the current run, including an in-flight model request
or a retry wait, and withdraws queued input. Those submissions settle as
`unanswered`, and open `send()` streams close with that receipt. History and
configuration are kept, so a held configuration version and new messages apply immediately after.

`Agent.sendTo(targetId, message)` admits the target from the registry and calls its
`sendMessage` over Durable Object RPC, for callers and future orchestration. It acknowledges
durable admission rather than waiting for the target model to finish. This is a
transport primitive, not a durable multi-agent workflow or automatic LLM tool.

Active work has a recovery alarm. On wake, the object reopens Pi's SQLite storage,
reconstructs pending tasks, and resumes the scheduler. Once tasks settle, the
alarm is removed. Model calls can be repeated after interruption; request ID
deduplication prevents duplicate durable inputs, not exactly-once provider billing.

## Connecting the future UI

Add `@kodama/agents: workspace:*` to `packages/ui`. Its server Worker can bind to
the exported config, which retains the RPC types:

```ts
// Inside packages/ui/cloudflare.config.ts:
import agents from '@kodama/agents/config'
import { bindings } from 'cf/config'

// Add to the UI Worker's env configuration:
const agentBinding = bindings.worker({ worker: agents.worker })
const adminBinding = bindings.worker({ worker: agents.worker, exportName: 'AdminService' })
// env: { AGENT_SERVICE: agentBinding, ADMIN: adminBinding } — the UI Worker binds no D1
```

```ts
// Inside the UI's server-side handler:
const stream = await env.AGENT_SERVICE.send(agentId, {
  requestId: crypto.randomUUID(),
  content: 'Hello',
})
return new Response(stream, {
  headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
})
```

Browser code can import data contracts with `import type` from
`@kodama/agents/protocol`. Only server Workers call service-binding RPC. The UI
server owns user authentication and authorization for agent IDs. The agent
Worker has no public HTTP interface, and `workersDev` is disabled.

## Deployment

From `packages/agents`, use `nr cf auth login`, create the D1 databases `kodama-memory` and
`kodama-management` and apply their migrations, configure each provider's Worker secret (for
example, `nr cf workers secrets update OPENAI_API_KEY`), deploy with `nr deploy`, and call
`AdminService.seed()` once. See [docs/agents.md](docs/agents.md#deployment).
Use `nr cf workers secrets update --help` for the pinned CLI's input options.
This repository uses `cf`, `cloudflare.config.ts`, and the Cloudflare Vite plugin;
Wrangler is only a transitive dependency of Cloudflare's tooling.

## References

- [Pi Durable on Cloudflare](https://earendil.com/posts/pi-durable-on-cloudflare/)
- [Cloudflare cf CLI](https://blog.cloudflare.com/cloudflare-cf-cli-launch/)
- [Cloudflare RPC](https://developers.cloudflare.com/workers/runtime-apis/rpc/)

## Per-agent configuration and providers

```ts
const actor = { kind: 'agent', externalId: adminAgentId } as const
const { version, settings } = await env.ADMIN.getConfig(actor, agentId)
await env.ADMIN.updateConfig(actor, agentId, {
  requestId: crypto.randomUUID(),
  settings: {
    ...settings,
    model: { provider: 'xai', modelId: 'grok-4.3' },
    tools: ['current_time'],
  },
  expectedVersion: version,
})
```

Configuration is a sequence of immutable versions in the management database, read and written only
through `AdminService`. A new version takes effect from the agent's next turn, without a restart
or a deploy, even if the agent is busy when it is written; `getAgent` shows the desired and
applied versions separately until they converge. Two updates from the same version conflict:
exactly one succeeds. `rollbackConfig` writes an old version's content as a new version. The
default tool list is empty. Add tool implementations in `src/tools/` and register them in
`src/tools/index.ts`; agents enable registered tools by name.

`src/models/index.ts` registers Pi's built-in providers and model catalogs. The
provider keys are individual Worker secrets. For local development, write one
key per line in `packages/agents/.dev.vars`:

```dotenv
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
XAI_API_KEY=...
```

Only fill the providers you use; leave other keys empty. To support another provider's
credentials or options, add its secret binding in `cloudflare.config.ts` and allow
its environment name in `src/models/index.ts`. Keys remain in Worker secrets, outside
agent settings, storage, and RPC results. Submission checks authentication for
the selected provider. Provider/model IDs come from the installed Pi catalog;
updating Pi updates that catalog. Environment-based authentication is supported;
interactive OAuth login and local credential files are not implemented. Providers
requiring those flows need an additional authentication adapter. Provider-specific
reasoning levels and runtime requirements still apply. Integration tests exercise
OpenAI and xAI with mocked model responses; other providers have not been tested
against live services.

## Chat: send and stream in one request

`AgentService.send(agentId, message)` returns an SSE byte stream. The DO attaches
its observer before admitting input, then emits `accepted` with `requestId` and
`submissionId`, a context `snapshot`, and the events of the run handling that
submission. The terminal `submission` event (`done` or `unanswered`) closes the
stream. `AgentSendEvent` describes these payloads.

While the input is queued, unrelated runs' generation events are filtered out.
Snapshots provide agent-wide context, including history and any current run;
they are state replacement events, not new output attributed to this request.
A Pi run can handle multiple inputs; those inputs share that run's events.

The browser sends a POST with `fetch()` to the authenticated UI route and reads
its SSE response body. `EventSource` is for the separate observation route below,
since it cannot send a POST body. No second subscription or polling request is
needed for a chat turn.

Retry the same request ID and content after disconnecting. A completed retry
returns `accepted`, a fresh snapshot, and its terminal receipt without running
the model again. Disconnecting releases the observer but does not cancel the
accepted input. Admission errors reject the RPC before a response stream is
returned; stream/runtime failures require reconnecting with the same request ID.

## Agent-wide observation without polling

`AgentService.subscribe(agentId)` and `Agent.subscribe()` return an SSE byte
stream over Cloudflare RPC. The first event is an atomic Pi `snapshot`, including
history, in-flight generation, active tools, and configuration. Subsequent named
events include `message_update`, `message_end`, `tool_execution_start`,
`tool_execution_update`, `tool_execution_end`, `submission`, and `run_end`.
Their JSON payload type is exported as `AgentEvent` from `@kodama/agents/protocol`.
This is Pi's experimental event contract, pinned by the package version.

A future UI Worker can expose the stream after authenticating the user and
checking access to the agent:

```ts
const stream = await env.AGENT_SERVICE.subscribe(agentId)
return new Response(stream, {
  headers: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
  },
})
```

The browser can use `EventSource` for this authenticated same-origin route:

```ts
const events = new EventSource(`/api/agents/${agentId}/events`)
events.addEventListener('snapshot', (event) => replaceState(JSON.parse(event.data)))
events.addEventListener('message_update', (event) => applyMessageChanges(JSON.parse(event.data)))
events.addEventListener('submission', (event) => updateSubmission(JSON.parse(event.data)))
// Also handle message/tool lifecycle events needed by the UI.
// On component teardown:
events.close()
```

Use this continuous stream for monitoring and state synchronization. Chat turns
use the unified `send` API above. `sendMessage` remains an acceptance-only primitive
for agent-to-agent delivery. No polling is required. The agents
Worker remains private and does not expose an unauthenticated HTTP event route.

Each connection owns an independent subscription. Canceling the response body
propagates through RPC and releases its Pi observer without canceling generation.
The stream stays open between turns. Slow readers apply backpressure; Pi replaces
an overflowing backlog with a new `snapshot`, so clients must handle snapshots
at any point. Reconnect after a disconnect or DO restart to receive current state;
there is no event-ID replay or exactly-once event delivery. Clear local state on a
replacement snapshot rather than appending its history. Active subscriptions keep
the DO active; this implementation does not use WebSocket hibernation.
