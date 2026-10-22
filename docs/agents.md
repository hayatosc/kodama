# Agents

Kodama runs [Pi Durable](https://earendil.com/posts/pi-durable-on-cloudflare/) agents on
Cloudflare Durable Objects. Each `agentId` addresses one agent, and each agent is one
SQLite-backed Durable Object that owns these parts:

- its Pi session: conversation history, inbox, and configuration;
- its recovery alarm;
- its local copy of long-term memory.

Trusted Workers reach agents only through service-binding RPC; there is no public HTTP interface.

This document describes the runtime in `packages/agents`. Long-term memory, the memory agent,
pruning, and skills are described in [memory.md](memory.md).

## Layout

The pnpm workspace contains `packages/agents` (`@kodama/agents`). A web UI (`packages/ui`) is
planned and not implemented.

```text
packages/agents/
  cloudflare.config.ts      Worker, Durable Object exports, bindings, secrets, cron trigger
  drizzle.config.ts         drizzle-kit config for the D1 schema
  drizzle.local.config.ts   drizzle-kit config for kodama's tables in each Durable Object
  drizzle/
    d1/                     D1 schema (schema.ts) and its generated migrations (migrations/)
    durable-object/         schema of kodama's tables in each object, and their migrations
    schema.test.ts          each schema matches its generated migrations
  cli/                      local development CLI and its token-authenticated adapter
  src/
    index.ts                AgentService: the service-binding RPC entrypoint and cron handler
    env.ts                  the Worker's bindings, as a type
    protocol.ts             transport types; consumers import them with `import type`
    validation.ts           valibot schemas for untrusted RPC input
    lib/                    generic helpers that import nothing else from src/
    agent/                  the Agent Durable Object, its runtime, and its parts
      dedicated/            AgentObject, which picks a dedicated subclass by the object's name
        memory/             MemoryAgent, the memory agent: its class, configuration, queue, runner
    configuration/          per-agent configuration: validation and persistence
    models/                 Pi provider catalog and Worker secret resolution
    tools/                  tool implementations and their registry
    memory/                 long-term memory (see memory.md)
    storage/                opening kodama's tables in each object's SQLite, and Pi's tables
    helper/                 shared test helpers; tests sit next to their modules
```

### The Agent Durable Object

[`src/agent/agent.ts`](../packages/agents/src/agent/agent.ts) is the `Agent` class, a working
agent and the base class of every dedicated agent (see [Dedicated agents](#dedicated-agents)).
Classes exist only because a Durable Object must be one. `Agent` serves RPC and holds the object's in-memory state in private
fields: the open harness, the tasks the recovery alarm watches, the pruning pass in progress, and a
pending memory refresh. Everything else is a plain function that takes what it needs, in these
files:

| File         | Responsibility                                                                    |
| ------------ | --------------------------------------------------------------------------------- |
| `harness.ts` | Pi runtime composition, opening the harness, and the section that reopens it      |
| `views.ts`   | `snapshot()` and `submission()` results, mapped from Pi state                     |
| `memory.ts`  | the agent's use of long-term memory: refresh, extraction, pruning, the hard limit |
| `events.ts`  | SSE streams for `send()` and `subscribe()`                                        |
| `alarms.ts`  | one alarm per object, shared by several purposes, and the recovery alarm          |

Reading and replacing the configuration is in `src/configuration/`, and the paged entries the memory
agent reads are in `src/memory/transcript.ts`.

### Dedicated agents

A dedicated agent is a subclass of `Agent` that lives in the same `AGENTS` namespace under a
reserved name. There is no Durable Object class or binding per dedicated agent, so adding one
changes no Worker configuration:

- The Worker exports one Durable Object class, `AgentObject` from
  [`src/agent/dedicated/index.ts`](../packages/agents/src/agent/dedicated/index.ts), as `Agent`.
  Its constructor looks the object's name up in `DEDICATED_AGENTS` and returns an instance of that
  subclass; any other name gets a working `Agent`.
- A subclass changes behavior only through `Agent`'s protected hooks: harness options, default
  configuration, the last step of opening (`prepare`), idle work, alarms, and whether pruning
  archives.
- A method only a dedicated agent serves is declared on `Agent`, which rejects it, and the subclass
  overrides it. One stub type then covers every object in the namespace, with no type assertion.
- Reserved names contain `:`, which a public agent ID cannot, so `AgentService` and `sendTo` never
  reach a dedicated agent.

Each dedicated agent has a folder under `src/agent/dedicated/` with only what it adds to an agent.
The one today is the memory agent, `MemoryAgent`, named `kodama:memory`
([memory.md](memory.md#memory-agent)): its class (`agent.ts`), its configuration and prompts
(`config.ts`), its job queue (`queue.ts`), and the runner that drains it (`runner.ts`). The tools
it uses and daily consolidation are memory parts in `src/memory/`.

To add a dedicated agent, create its folder with a subclass, reserve a name with `:`, and add the
pair to `DEDICATED_AGENTS`.

### Opening an agent

On every open, the agent prepares the harness before any request sees it:

1. Pi's storage opens inside `blockConcurrencyWhile`, after kodama's own migrations are applied.
2. The root conversation is created, and its configuration is initialized from the defaults.
3. The subclass hook runs: a working agent refreshes its always-loaded memory, and the memory
   agent follows its model setting and starts its job drain.
4. The recovery alarm is reconciled with Pi's tasks.

If Pi's storage fails, the object aborts and is recreated on the next request.

## Dependencies

Code in `src/` is split into layers. A layer imports only itself and the layers below it, so a file's
imports say where it sits.

| Layer        | Paths                                                | May import                              |
| ------------ | ---------------------------------------------------- | --------------------------------------- |
| lib          | `src/lib/`                                           | nothing in `src/`                       |
| contracts    | `src/env.ts`, `src/protocol.ts`, `src/validation.ts` | lib                                     |
| settings     | `src/configuration/`, `src/models/`, `src/tools/`    | lib, contracts                          |
| storage      | `drizzle/`, `src/storage/`                           | lib                                     |
| memory store | `src/memory/store/`                                  | lib, storage                            |
| memory       | the rest of `src/memory/`                            | lib, contracts, storage, memory store   |
| agent        | `src/agent/`, except `agent.ts` and `dedicated/`     | all of the above                        |
| Agent class  | `src/agent/agent.ts`                                 | all of the above                        |
| memory agent | `src/agent/dedicated/`                               | all of the above, including Agent class |
| entrypoint   | `src/index.ts`                                       | lib, contracts, memory, memory agent    |

Some consequences:

- `src/lib/` holds helpers with no knowledge of agents or memory: hashing (`hash.ts`), search
  words (`search-text.ts`), and the two ordering helpers the `Agent` class uses (`serial.ts`).
- The memory parts (archive, skills, prune, shared, tools, working, consolidation) do not know the `Agent` class or the
  memory agent. What they need from the memory agent is its input contract in
  `src/memory/jobs.ts`: the job kinds and the object's name.
- `Agent` never imports a dedicated agent. `MemoryAgent` extends it and overrides its hooks, and
  `src/agent/dedicated/index.ts` maps reserved names to subclasses, so `src/agent/dedicated/` sits
  above `agent.ts` and the rest of the agent runtime.
- Tests may import anything, including the helpers in `src/helper/`. Production code never
  imports `src/helper/`.

## Harness

[`src/agent/harness.ts`](../packages/agents/src/agent/harness.ts) composes the Pi runtime. Working agents and the
memory agent share these settings:

| Setting                 | Value                                                                   |
| ----------------------- | ----------------------------------------------------------------------- |
| model request timeout   | 5 minutes; a stalled request fails as a timeout and is retried          |
| retries                 | transient failures retried without an attempt limit, backing off 2–30 s |
| document/context caches | retention 0, so idle agents can be evicted                              |
| compaction              | Pi's built-in compaction with its defaults                              |

The registry holds the `kodama` extension with every registered tool. Each working agent also gets
the `kodama-memory` extension with its memory tools and prompt sections, whatever tools it enables
(see [memory.md](memory.md#working-agents)). No execution environment is configured, so a working
agent sees no files and runs no commands.

## Configuration

Each agent persists its own configuration in Pi Durable
([`src/configuration/`](../packages/agents/src/configuration/)):

```ts
interface AgentConfig {
  model: { provider: string; modelId: string }
  systemPrompt: string // at most 64,000 characters
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  tools: string[] // unique names of registered tools
  sharedSpaces: string[] // shared memory spaces read by this agent; default ["global"]
}
```

New agents start with these defaults:

- the model is `DEFAULT_MODEL_PROVIDER` and `DEFAULT_MODEL_ID` from `cloudflare.config.ts`;
- the system prompt is `DEFAULT_SYSTEM_PROMPT` in `src/configuration/index.ts`;
- thinking is off;
- no tools are enabled;
- `sharedSpaces` is `["global"]`.

The defaults apply only to new agents.

`setConfig` replaces the whole configuration and validates it strictly. Unknown fields, unknown
models, and unregistered tools are rejected. It is refused while work is pending, keeps history and
request IDs, and survives eviction.

`sharedSpaces` is stored separately under the `kodama:shared-spaces` storage key, because Pi's
configuration has no place for it. Storing it refreshes the always-loaded memory and the skills
list.

```ts
using config = await env.AGENT_SERVICE.getConfig('researcher')
using updated = await env.AGENT_SERVICE.setConfig('researcher', {
  ...config,
  model: { provider: 'xai', modelId: 'grok-4.3' },
  systemPrompt: 'You are a careful research assistant.',
  thinkingLevel: 'low',
  tools: ['current_time'],
})
```

### Models and credentials

[`src/models/index.ts`](../packages/agents/src/models/index.ts) registers Pi's built-in providers
and model catalogs. Provider and model IDs come from the installed Pi catalog, so updating Pi
updates the catalog.

Credentials are individual Worker secrets: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`,
and `XAI_API_KEY`. They stay out of agent settings, storage, and RPC results.

`sendMessage` checks that the selected provider has credentials before it admits input.

To support another provider:

1. Add its secret binding in `cloudflare.config.ts`.
2. Allow its environment name in `src/models/index.ts`.

Only environment-based authentication is supported. Interactive OAuth login and local credential
files are not.

The memory agent uses `MEMORY_MODEL_PROVIDER` and `MEMORY_MODEL_ID`. When they are empty, it uses
the default model.

### Tools

To add a tool:

1. Implement it in `src/tools/`, in a lowercase hyphenated file such as `current-time.ts`.
2. Register it in [`src/tools/index.ts`](../packages/agents/src/tools/index.ts).

Agents enable registered tools by name in `tools`, and the default list is empty. The only tool
today is `current_time`. The memory tools come from the memory extension, not from this list.

## RPC contract

[`AgentService`](../packages/agents/src/index.ts), the Worker's default export, validates agent IDs
at the boundary and forwards to the agent's Durable Object:

| Method                                         | Result                                       |
| ---------------------------------------------- | -------------------------------------------- |
| `send(agentId, { requestId, content })`        | SSE response through terminal submission     |
| `subscribe(agentId)`                           | Continuous agent-wide SSE observation        |
| `sendMessage(agentId, { requestId, content })` | Durable acceptance with `submissionId`       |
| `submission(agentId, requestId)`               | Submission status, or `undefined`            |
| `getConfig(agentId)`                           | Persisted agent configuration                |
| `setConfig(agentId, config)`                   | Replace configuration while idle             |
| `snapshot(agentId)`                            | Committed user/assistant messages and `busy` |
| `cancel(agentId)`                              | Stop current work; resolves once idle        |

`AgentService` cannot reach the memory agent: its name is not a valid public agent ID. The Agent
object has a few more methods for other Durable Objects:

| Method                          | Caller       | Effect                                                         |
| ------------------------------- | ------------ | -------------------------------------------------------------- |
| `sendTo(agentId, message)`      | an agent     | deliver to another agent; returns once the target admits input |
| `readEntries({ after, limit })` | memory agent | conversation text after an entry, from Pi or from the archive  |
| `memoryChanged()`               | memory agent | refresh the always-loaded memory now, or when next idle        |
| `prune({ force })`              | maintenance  | archive and delete old entries                                 |
| `enqueue(job)`, `jobStatus(id)` | agents       | queue a memory job and read its status (memory agent only)     |
| `consolidate(now)`              | cron         | the daily consolidation (memory agent only)                    |

### IDs, limits, and retries

- Agent IDs are 1–64 letters, digits, `_`, or `-`. Request IDs use the same characters, up to 128.
- Messages must be nonblank and at most 16,000 characters. Invalid input throws a `TypeError`
  ([`src/validation.ts`](../packages/agents/src/validation.ts)).
- Request IDs are scoped to the receiving agent's root conversation. To retry a delivery, reuse the
  same request ID and content; a completed retry returns the first result without running the
  model again. Use a new request ID for a new turn.
- Input that arrives while an agent is busy is queued by Pi Durable. `whenBusy` controls how:
  - `followUp` (the default) waits for the current run to answer and then starts the next run;
  - `steer` joins the current run after its current tool round.

  Neither interrupts an executing tool, and when the agent is idle, both start a run immediately.

- Transient provider failures do not fail a turn. Rate limits, 5xx responses, request timeouts,
  and dropped connections are retried as described in [Harness](#harness), and the wait is durable
  across eviction. Invalid credentials, exhausted quota, and other non-retryable errors settle the
  turn as `unanswered`.
- Above the hard storage limit, `sendMessage` rejects new input with a retryable
  `storage_maintenance` error until pruning has freed space (see
  [memory.md](memory.md#pruning)).

```ts
await env.AGENT_SERVICE.sendMessage('assistant', {
  requestId: crypto.randomUUID(),
  content: 'Prioritize the failing tests.',
  whenBusy: 'steer',
})
```

### Submissions and snapshots

`submission(agentId, requestId)` reports the status of one input:

- `done` means an answer was committed;
- `unanswered` means generation produced no answer. Its `reason` (for example `model_error`) and
  text `detail` (such as the provider's message) say why.

Other Pi submission states are kept in the typed result.

`snapshot()` returns committed user and assistant text, plus whether the agent is busy.

### Cancel

`cancel(agentId)` stops the current run, including an in-flight model request or a retry wait, and
withdraws queued input. Those submissions settle as `unanswered`, and open `send()` streams close
with that receipt. History and configuration are kept, so `setConfig` and new messages work right
after.

### Agent to agent

`Agent.sendTo(targetId, message)` calls `this.env.AGENTS.getByName(targetId).sendMessage(message)`.
It acknowledges durable admission and does not wait for the target's model. It is a transport
primitive, not a multi-agent workflow or a model-invoked tool.

## Events

[`src/agent/events.ts`](../packages/agents/src/agent/events.ts) turns Pi's observation API into SSE byte
streams over Cloudflare RPC. The JSON payloads are typed as `AgentSendEvent` and `AgentEvent` in
`@kodama/agents/protocol`. `AgentEvent` is Pi's experimental event contract, pinned by the package
version.

### `send`: one request, one stream

`send(agentId, message)` attaches its observer before it admits the input. The stream then carries:

1. `accepted`, with `requestId` and `submissionId`;
2. a context `snapshot`;
3. the events of the run that handles the submission;
4. the terminal `submission` event (`done` or `unanswered`), which closes the stream.

While the input is queued, unrelated runs' generation events are filtered out. A Pi run can handle
several inputs, and those inputs share its events. Snapshots replace state; they are not new output
of this request.

Admission errors reject the RPC before a stream is returned. Disconnecting releases the observer
but does not cancel the accepted input. To reattach, send again with the same request ID: a
completed retry returns `accepted`, a fresh snapshot, and its terminal receipt.

### `subscribe`: agent-wide observation

`subscribe(agentId)` starts with an atomic Pi `snapshot`: history, in-flight generation, active
tools, and configuration. Named events follow, such as `message_update`, `message_end`,
`tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `submission`, and
`run_end`.

Delivery works like this:

- Each connection owns its own subscription. Canceling the response body releases the Pi observer
  without canceling generation, and the stream stays open between turns.
- Slow readers apply backpressure. Pi replaces an overflowing backlog with a new `snapshot`, so
  clients must handle a snapshot at any point and replace their state rather than append to it.
- There is no event-ID replay. After a disconnect or restart, reconnect to receive the current
  state.
- An open subscription keeps the object active; WebSocket hibernation is not used.

## Alarms and recovery

A Durable Object has one alarm. [`alarms.ts`](../packages/agents/src/agent/alarms.ts) stores one due
time per purpose and sets the platform alarm to the earliest. It reads and writes the times with the
synchronous storage API (`ctx.storage.kv`), so two updates never interleave:

| Purpose    | Meaning                                                           |
| ---------- | ----------------------------------------------------------------- |
| `recovery` | resume Pi's scheduler after eviction while work is pending        |
| `extract`  | hand new entries to the memory agent after 10 minutes idle        |
| `prune`    | archive and delete old entries when storage is over its threshold |
| `jobs`     | the memory agent's job runner                                     |

The same file keeps the `recovery` purpose set while Pi has
runnable tasks. The alarm is armed before input is admitted, which covers the window between
admission and Pi's scheduler. Admissions and recovery refreshes run in one serial queue
(`src/lib/serial.ts`), so a refresh never clears an alarm that an admission just armed.

On wake, the object reopens Pi's storage, reconstructs pending tasks, and resumes the scheduler.
When no task is left, recovery clears only its own time and runs the idle work: scheduling
extraction and pruning, and any pending memory refresh.

Model calls can be repeated after an interruption. Request IDs prevent duplicate durable inputs,
not duplicate provider billing.

## Storage in the Durable Object

Each object's SQLite holds two sets of tables:

- **Pi Durable's tables**: entries, tasks, documents, submissions, and their metadata. Pi creates
  and migrates them. Pruning deletes old rows through the column definitions in
  [`src/storage/pi-tables.ts`](../packages/agents/src/storage/pi-tables.ts), which must be checked
  on every Pi upgrade.
- **Kodama's tables**, prefixed `kodama_`, defined in
  [`drizzle/durable-object/schema.ts`](../packages/agents/drizzle/durable-object/schema.ts): the
  memory agent's job queue, the `remember` count per turn, the always-loaded memory copy, and
  pruning runs. Their migrations are generated into `drizzle/durable-object/migrations` and
  applied by `src/storage/local.ts` before the harness opens.

Small values such as alarm times, prune limits, and shared spaces use the object's key-value
storage under `kodama:` keys.

## Development

Use Node.js >=22.19 and pnpm 12.14.0 through the `ni`/`nr` wrappers:

```sh
ni
cp packages/agents/.dev.vars.example packages/agents/.dev.vars
# Fill in the API keys of the providers you use.
nr dev:agents
```

`nr dev:agents` runs `cf dev`, which starts the Vite-powered Worker with local D1, R2, and Durable
Objects. It exposes RPC, not a browser page.

| Command                                       | Effect                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| `nr check`                                    | TypeScript, type-aware Oxlint, Oxfmt check, and tests                    |
| `nr test`                                     | workspace tests                                                          |
| `nr format`                                   | format the repository                                                    |
| `nr build` (in `packages/agents`)             | `cf build` into `.cloudflare/output/v0/`, no deploy                      |
| `nr cf:types` (in `packages/agents`)          | regenerate runtime types                                                 |
| `nr db:generate` (in `packages/agents`)       | write a D1 migration after `drizzle/d1/schema.ts` changes                |
| `nr db:generate:local` (in `packages/agents`) | write a local migration after `drizzle/durable-object/schema.ts` changes |

### Local agent CLI

With `nr dev:agents` running, send messages from another terminal at the repository root:

```sh
nr agent send assistant "Hello!"
nr agent send assistant "Continue the conversation."
nr agent snapshot assistant
nr agent cancel assistant
nr agent send assistant "Hello!" --request-id my-test-1
nr agent send assistant "Change direction." --steer
nr agent send assistant "Hello!" --events
nr agent --help
```

The CLI works like this:

- The same agent ID keeps its conversation in local Durable Object storage.
- `send` prints assistant text as it arrives, prints request IDs on stderr, and exits nonzero on a
  model failure or an interrupted stream. `--events` prints the JSON events instead.
- Ctrl+C disconnects the CLI without stopping the agent; `cancel` stops it.

The CLI ([`cli/`](../packages/agents/cli/)) connects to a token-authenticated adapter at
`127.0.0.1:5173`, which calls the Durable Object RPC methods. Only the `development` mode selects
the adapter. Its token is generated into the ignored `.cloudflare/cli-token`; restart the dev
server if another configuration evaluation replaces it.

`cf build` and `cf deploy` use the private production entrypoint. Never deploy with
`--mode development`.

## Testing

Tests use Vitest with the Cloudflare plugin, so they run inside workerd with real RPC, Pi Durable,
SQLite, D1, R2, eviction, and alarms. Only the external model request is mocked, and no API key is
needed. `vitest.config.ts` reads the generated D1 migrations for the setup. It also passes the
columns from the drizzle-kit snapshots, so a test fails when a schema and its migrations differ.

Tests sit next to the module they test, as `<module>.test.ts` in the same folder. Shared helpers
are in `src/helper/`, which production code never imports, and `vitest.setup.ts` applies the D1
migrations before the tests.

| Path                                        | Contents                                                      |
| ------------------------------------------- | ------------------------------------------------------------- |
| `src/helper/model.ts`                       | mocked OpenAI Responses streams: text, tool calls, inspection |
| `src/helper/rpc.ts`                         | a scripted default model, `waitForAnswer`, and SSE readers    |
| `src/helper/conversation.ts`                | a long conversation that compacts, for pruning tests          |
| `src/helper/memory.ts`                      | the memory database, records, and the memory agent            |
| `src/agent/agent.test.ts`                   | the Agent RPC and input validation                            |
| `src/agent/events.test.ts`                  | `send` and `subscribe` streams                                |
| `src/agent/alarms.test.ts`                  | alarm purposes; failures, cancellation, and recovery          |
| `src/configuration/index.test.ts`           | the schema, and configuration over RPC and across eviction    |
| `src/models/index.test.ts`                  | provider credentials                                          |
| `cli/handler.test.ts`, `cli/stream.test.ts` | the development adapter and the CLI's stream handling         |
| `drizzle/schema.test.ts`                    | the schemas match their generated migrations                  |

The memory tests are listed in [memory.md](memory.md#testing). Name a new test file after the
module it tests, describe the observable behavior it checks, and run `nr check` before submitting.

## Deployment

From `packages/agents`:

1. Log in with `nr cf auth login`.
2. Create the D1 database `kodama-memory` and the R2 bucket `kodama-archive` that
   `cloudflare.config.ts` binds.
3. Apply the D1 migrations with `nr cf d1 migrations apply --dir drizzle/d1/migrations`.
4. Set each provider's secret, for example `nr cf workers secrets update OPENAI_API_KEY`. Use
   `nr cf workers secrets update --help` for the pinned CLI's options.
5. Deploy with `nr deploy`.

The Worker exports one Durable Object class, `Agent`, with SQLite storage, bound as `AGENTS`; the
memory agent is an object of it (see [Dedicated agents](#dedicated-agents)). Its cron trigger (`17 3 * * *`, UTC) runs the daily memory consolidation. `workersDev` is disabled.
This repository uses `cf`, `cloudflare.config.ts`, and the Cloudflare Vite plugin; Wrangler is only
a transitive dependency.

## Connecting a UI

A future `packages/ui` server Worker binds to the exported config, which keeps the RPC types:

```ts
// packages/ui/cloudflare.config.ts
import agents from '@kodama/agents/config'
import { bindings } from 'cf/config'

const agentBinding = bindings.worker({ worker: agents.worker })
// env: { AGENT_SERVICE: agentBinding }
```

```ts
// A server-side chat route, after authenticating the user and checking access to the agent:
const stream = await env.AGENT_SERVICE.send(agentId, {
  requestId: crypto.randomUUID(),
  content: 'Hello',
})
return new Response(stream, {
  headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
})
```

The browser posts chat input with `fetch()` and reads the SSE response body. For continuous
observation, it uses `EventSource` on a separate route backed by `subscribe()`, because
`EventSource` cannot send a POST body. Browser code imports data contracts with `import type` from
`@kodama/agents/protocol`.

## Security

- The agent Worker has no public HTTP interface. Only server Workers call its service-binding RPC.
  A UI Worker must authenticate users and authorize their access to agent IDs.
- Provider credentials are Worker secrets, outside agent settings and RPC results. Never commit
  `.dev.vars`, credentials, or generated `.cloudflare/` state.
- Untrusted RPC input is validated with valibot at the boundary.
- Long-term memory does not yet redact secrets or reject text written as instructions; a shared
  space accepts only records that two agents keep (see [memory.md](memory.md#shared-memory)).

## References

- [Pi Durable on Cloudflare](https://earendil.com/posts/pi-durable-on-cloudflare/)
- [Pi Durable spec](https://github.com/earendil-works/pi/blob/main/packages/durable/docs/spec.md)
- [Cloudflare cf CLI](https://blog.cloudflare.com/cloudflare-cf-cli-launch/)
- [Cloudflare RPC](https://developers.cloudflare.com/workers/runtime-apis/rpc/)
- [Durable Objects SQLite storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
