# Agents

Kodama runs [Pi Durable](https://earendil.com/posts/pi-durable-on-cloudflare/) agents on
Cloudflare Durable Objects. Each agent has a server-issued UUID, its `agentId`, in a registry in the
management database (see [Management database](#management-database)), and each agent is one SQLite-backed
Durable Object that owns these parts:

- its Pi session: conversation history, inbox, and configuration;
- its recovery alarm;
- its local copy of long-term memory;
- its applied copy of the configuration version the registry asks for.

Trusted Workers reach agents only through service-binding RPC; there is no public HTTP interface.

This document describes the runtime in `packages/agents`. Long-term memory, the memory agent,
pruning, and skills are described in [memory.md](memory.md).

## Layout

The pnpm workspace contains `packages/agents` (`@kodama/agents`). A web UI (`packages/ui`) is
planned and not implemented.

```text
packages/agents/
  cloudflare.config.ts      Worker, Durable Object exports, bindings, secrets, cron trigger
  drizzle.memory.config.ts  drizzle-kit config for the long-term memory D1 schema (drizzle/memory/)
  drizzle.management.config.ts
                            drizzle-kit config for the management D1 schema (drizzle/management/)
  drizzle.durable-object.config.ts
                            drizzle-kit config for kodama's tables in each Durable Object
                            (drizzle/durable-object/)
  drizzle/
    memory/                 long-term memory D1 schema (schema.ts) and its migrations (migrations/)
    management/             management D1 schema: registry, versions, principals, audit; migrations
    durable-object/         schema of kodama's tables in each object, and their migrations
  cli/                      local development CLI and its token-authenticated adapter
  src/
    index.ts                AgentService: the service-binding RPC entrypoint and cron handler
    management/             the management database: registry, admission, versions, lifecycle, audit
      service/              registry, configuration versions, seed, reconciliation flows
    env.ts                  the Worker's bindings, as a type
    protocol.ts             transport types; consumers import them with `import type`
    validation.ts           valibot schemas for untrusted RPC input
    lib/                    generic helpers that import nothing else from src/
    agent/                  Agent RPC, working-agent options, and memory integration
    runtime/                shared harness, alarms, streams, configuration, and pruning control
    system-agents/          internal agents that support Kodama, under reserved object names
      memory/               MemoryAgent: its class, configuration, queue, and runner
    agent-object.ts         AgentObject, which selects a working or system agent by the object's name
    configuration/          per-agent configuration: validation and persistence
    models/                 Pi provider catalog with explicit D1 credentials only
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
files (paths relative to `src/`):

| File                            | Responsibility                                                     |
| ------------------------------- | ------------------------------------------------------------------ |
| `agent/config.ts`               | Working-agent model and optional tool registration                 |
| `agent/memory.ts`               | Working-agent memory refresh and extraction                        |
| `agent/memory-extension.ts`     | Working-agent memory tools and prompt hooks                        |
| `agent/runtime/harness.ts`      | Shared Pi settings, opening the harness, and its exclusive section |
| `agent/runtime/views.ts`        | `snapshot()` and `submission()` results, mapped from Pi state      |
| `agent/runtime/pruning.ts`      | Shared pruning scheduling and storage limits                       |
| `agent/runtime/events.ts`       | SSE streams for `send()` and `subscribe()`                         |
| `agent/runtime/alarms.ts`       | Shared alarm purposes and recovery                                 |
| `agent/runtime/config-apply.ts` | Applying or holding configuration versions                         |
| `agent/runtime/restrictions.ts` | Checks before external calls                                       |

`Agent` is the working agent; there is no separate `WorkingAgent` class. Its memory integration
lives beside it, not in the shared runtime. `MemoryAgent` inherits `Agent` and replaces the
working-agent defaults through protected hooks.

Reading and replacing the configuration is in `src/control-plane/config.ts`, and the paged entries the memory
agent reads are in `src/memory/transcript.ts`.

### Dedicated agents

System agents support Kodama's internal functions, such as managing long-term memory. They live
under `src/agent/dedicated/`, separately from the shared execution machinery in `src/agent/runtime/`
and the memory capabilities in `src/memory/`. Working agents are registry rows and configuration,
not one source folder per agent.

A system agent is a dedicated subclass of `Agent` that lives in the same `AGENTS` namespace under a
reserved name. The registry still calls this kind `dedicated`. There is no Durable Object class or
binding per dedicated agent, so adding one changes no Worker configuration:

- The Worker exports one Durable Object class, `AgentObject` from
  [`src/agent-object.ts`](../packages/agents/src/agent-object.ts), as `Agent`.
  Its constructor looks the object's name up in `DEDICATED_AGENTS` and returns an instance of that
  subclass; any other name gets a working `Agent`.
- A subclass changes behavior only through `Agent`'s protected hooks: harness options, default
  configuration, the last step of opening (`prepare`), idle work, alarms, and whether pruning
  archives.
- A method only a dedicated agent serves is declared on `Agent`, which rejects it, and the subclass
  overrides it. One stub type then covers every object in the namespace, with no type assertion.
- Reserved names contain `:`, which a public agent ID (a UUID) cannot. Each dedicated agent is a
  registry row with `kind = 'dedicated'` and a fixed UUID mapped to its reserved `object_name`;
  `AgentService` and `sendTo` admit only working agents, so they never reach a dedicated agent.

Each system agent has a folder under `src/agent/dedicated/` with only what it adds to an agent.
The one today is the memory agent, `MemoryAgent`, named `kodama:memory`
([memory.md](memory.md#memory-agent)): its class (`agent.ts`), its configuration and prompts
(`config.ts`), and the runner that drains its queue (`runner.ts`). The queue's SQLite operations
live in `src/agent/local-db/memory-jobs.ts`; its dedicated model-facing tools live in `src/tools/memory/curator/`, and memory
workflows, including daily consolidation, live in `src/memory/`.

To add a system agent, create its folder with a subclass, reserve a name with `:`, and add the
pair to `DEDICATED_AGENTS` in `src/agent-object.ts`.

### Opening an agent

On every open, the agent prepares the harness before any request sees it:

1. Pi's storage opens inside `blockConcurrencyWhile`, after kodama's own migrations are applied.
2. The root conversation is created, and its configuration is initialized from the defaults.
3. The object catches up with the registry: when the desired version is newer than the one it
   applied, it applies it, or holds it if work is pending (see
   [Applying versions](#applying-versions)).
4. The subclass hook runs: a working agent refreshes its always-loaded memory, and the memory
   agent starts its job drain.
5. The recovery alarm is reconciled with Pi's tasks.

If Pi's storage fails, the object aborts and is recreated on the next request.

## Dependencies

Code in `src/` is split into layers. A layer imports only itself and the layers below it, so a file's
imports say where it sits.

| Layer              | Paths                                                                                                                                                                | May import                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| lib                | `src/lib/`                                                                                                                                                           | nothing in `src/`                                                                       |
| contracts          | `src/env.ts`, `src/protocol.ts`, `src/validation.ts`                                                                                                                 | lib                                                                                     |
| settings           | `src/control-plane/config.ts`, `src/control-plane/models.ts`                                                                                                         | lib, contracts, tool registry                                                           |
| memory contracts   | `src/memory/jobs.ts`, `src/memory/skills.ts`                                                                                                                         | lib                                                                                     |
| storage            | `drizzle/`, `src/agent/local-db/`                                                                                                                                    | lib, memory contracts                                                                   |
| management         | `src/control-plane/`, except `service/`                                                                                                                              | lib, contracts, settings, storage                                                       |
| credential storage | `src/credentials/`, except the management flows below                                                                                                                | lib, contracts, settings, storage, management                                           |
| memory store       | `src/memory/store/`                                                                                                                                                  | lib, storage, memory contracts                                                          |
| memory             | the rest of `src/memory/`                                                                                                                                            | lib, contracts, storage, memory store                                                   |
| runtime            | `src/agent/runtime/`                                                                                                                                                 | lib, contracts, settings, storage, management, credential storage, memory store, memory |
| tools              | `src/tools/`                                                                                                                                                         | all of the above                                                                        |
| agent              | `src/agent/`                                                                                                                                                         | all of the above                                                                        |
| system agents      | `src/agent/dedicated/`                                                                                                                                               | all of the above, including Agent                                                       |
| management service | `src/control-plane/workflows/`, `src/credentials/management.ts`, `src/credentials/assignments.ts`, `src/credentials/invalidation.ts`, `src/credentials/bootstrap.ts` | all of the above                                                                        |
| entrypoint         | `src/index.ts`, `src/agent-object.ts`                                                                                                                                | all of the above                                                                        |

Some consequences:

- `src/lib/` holds helpers with no knowledge of agents or memory: hashing (`hash.ts`), search
  words (`search-text.ts`), UUIDs (`uuid.ts`), error text (`errors.ts`), and the two ordering
  helpers the `Agent` class uses (`serial.ts`).
- `src/control-plane/`, except `service/`, knows the management database and nothing of objects; the
  agent runtime uses it to report applied versions and to admit `sendTo`. Only
  management-service-layer flows and the entrypoint push to objects, because the seed needs the
  memory agent's configuration. Credential queries and helpers stay in `src/credentials/`;
  configuration writers in the service layer compose reverse-index statements in their batches.
  The lower management layer never imports credential storage.
- Credential code stays in `src/credentials/`; contracts, settings, and memory stores do not depend
  on credential storage or inspect credentials to rewrite content.
- `src/tools/` owns model-facing definitions and tool-specific execution: names, schemas,
  descriptions, admission orchestration, external transport, and result formatting. Web definitions,
  execution, and provider protocols live together in `src/tools/web/`; `contact.ts` resolves
  contact targets and observes replies through the supplied `sendTo` operation.
  `src/tools/memory/working.ts` serves working agents; `src/tools/memory/curator/` serves only
  the memory agent. Neither tool set imports the other's adapters. Tools call memory workflows or
  store functions, never construct Drizzle queries or import agent classes. Agents supply shared
  state and operations; prompt refresh, extraction scheduling, and peer delivery remain outside tools.
  Pure argument normalization in `src/tools/web/url.ts` is also used by RPC validation.
  `src/tools/index.ts` registers optional general tools; memory tools are wired by the working agent's
  extension or the system agent's configuration, not by settings.
- `src/memory/` owns job permissions, extraction, shared-write validation, prompt assembly, and
  pruning orchestration. Its database queries live in `src/memory/store/` (D1) or `src/agent/local-db/`
  (object SQLite). R2 encoding and IO remain explicit in `src/memory/archive/`.
- Memory code never imports tool adapters, the `Agent` class, or a system agent. It uses the
  input contract in `src/memory/jobs.ts`. Pure skill rules in `src/memory/skills.ts` are also
  shared with persistence; neither contract imports workflow or storage implementations.
  `RunningJob` is a type-only queue contract in `src/memory/extraction/context.ts`.
- `src/agent/memory-extension.ts` wires memory tools and hooks into Pi. Workflows do not
  register tools or depend on a tool execution API.
- `src/agent/runtime/` contains shared execution functions, not agent classes, tool registration, or
  working-agent memory policy. It never imports `src/agent/` or system agents. `MemoryAgent`
  extends `Agent` and overrides its hooks, so `src/agent/dedicated/` sits above `src/agent/`.
  At the composition boundary, `src/agent-object.ts` imports both and maps reserved names to subclasses.
- Tests may import anything, including the helpers in `src/testing/`. Production code never
  imports `src/testing/`.

## Harness

[`src/agent/runtime/harness.ts`](../packages/agents/src/agent/runtime/harness.ts) opens Pi and provides shared execution settings.
Working-agent model and tool composition lives in `src/agent/config.ts`; the memory agent's is in
`src/agent/dedicated/memory/config.ts`. Both use these settings:

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

## Management database

Kodama has two D1 databases. `kodama-memory` (`MEMORY_DB`, schema in `drizzle/memory/`) holds long-term
memory ([memory.md](memory.md)). `kodama-management` (`MANAGEMENT_DB`, schema in
[`drizzle/management/schema.ts`](../packages/agents/drizzle/management/schema.ts)) holds the source of
truth for agents:

| Table                   | Contents                                                                        |
| ----------------------- | ------------------------------------------------------------------------------- |
| `agents`                | the registry: ID, object name, kind, display name, slug, state, versions, owner |
| `agent_config_versions` | immutable configuration versions, numbered per agent                            |
| `principals`            | who may call management RPC: people, service tokens, and agents                 |
| `agent_members`         | roles on one agent                                                              |
| `system_settings`       | `install_id`, lazily initialized on first use, and the reconciliation cursor    |
| `audit_log`             | append-only changes, written in the batch of the change, keyed by `op_id`       |

Only the agents Worker binds either database. The UI Worker binds no D1 and reaches both through
RPC. Foreign keys are declared and enforced by D1, and every change is one `batch()`, so a violation
rolls the whole change back (`src/control-plane/db.test.ts` checks these behaviors). Registry
rows are never deleted, so an agent ID is never reused.

### Registry and admission

- `agent_id` is a UUID v7 issued by the server, never reused, and never changed by a rename.
  Public IDs are lowercase canonical UUID v7 values; v4 is rejected. Generation delegates to
  the `uuid` package's `v7({ msecs })` through `src/lib/uuid.ts`. IDs sort by their supplied Unix
  millisecond timestamp; ordering within a single millisecond is not guaranteed.
- `display_name` and `slug`, a unique alias that is never UUID-shaped, can change at any time.
- `object_name` is the Durable Object name and the storage key of the memory scope, skills, and
  archive. It equals `agent_id`, except for dedicated agents; a check constraint allows the
  exception only for `kind = 'dedicated'`. Every object is reached as
  `AGENTS.getByName(object_name)` read from the registry.

`AgentService` admits a call right before it reaches the object
([`src/control-plane/registry.ts`](../packages/agents/src/control-plane/registry.ts)). It rejects an ID that is
not a UUID, a UUID not in the registry, and a dedicated agent's UUID with a `TypeError`, before
any harness or storage is opened, so an unknown ID never creates an object. A known agent whose
state does not allow the call is refused with `agent_unavailable:`. `sendTo` admits its target the
same way.

`resolveAgent` accepts a UUID, a slug, or a UUID prefix of at least 4 characters; an ambiguous
prefix is an error that lists the candidates. A slug of hex digits that is also another agent's
UUID prefix is ambiguous too, so a rename cannot capture messages addressed by that prefix.

### Lifecycle

The table lists the states and their planned moves.
[`src/control-plane/lifecycle.ts`](../packages/agents/src/control-plane/lifecycle.ts) defines what each
state admits; the moves are enforced once the work that carries them out lands. The registry's
`status` is the source, and each object holds a copy (see [Restrictions](#restrictions)).

| State          | May move to                       | Chat | Reads | External calls |
| -------------- | --------------------------------- | ---- | ----- | -------------- |
| `provisioning` | `active`, `deleting`              | no   | no    | yes            |
| `active`       | `pausing`, `archived`, `deleting` | yes  | yes   | yes            |
| `pausing`      | `paused`, `active`                | no   | yes   | no             |
| `paused`       | `active`, `archived`, `deleting`  | no   | yes   | no             |
| `archived`     | `active`, `deleting`              | no   | yes   | no             |
| `deleting`     | `deleted`                         | no   | no    | no             |
| `deleted`      | —                                 | no   | no    | no             |

Creation moves an agent from `provisioning` to `active`. Pause, archive, and delete are defined
here and carried out by later work.

### Seed

`AgentService.seed(credentials?)` ([`src/control-plane/workflows/seed.ts`](../packages/agents/src/control-plane/workflows/seed.ts))
creates the initial agents idempotently. Fresh agents require explicit credential references.
The stable `install_id` UUID v7 is initialized lazily on first use by registration, login or seed;
it does not imply any agents exist. Seed ensures these rows:

- the memory agent's row, `kind = 'dedicated'` with the fixed UUID
  `00000000-0000-7000-8000-00000000000a` mapped to `object_name = 'kodama:memory'`, and its
  version 1 from `MEMORY_MODEL_*`; it keeps its existing object;
- the first agent: a working agent with the slug `assistant` and a general-purpose prompt
  (`FIRST_AGENT_PROMPT`) as version 1, which `updateConfig` can change. The system creates it
  through `createAgent`, like any other agent; it has no owner and is not a principal.

Later calls write nothing new: the memory agent's rows are inserted only if missing, and the first
agent's `createAgent` uses a fixed `requestId`, so a renamed or reconfigured first agent keeps its
changes. The seed then applies the memory agent's version.

### Management RPC

The default `AgentService` ([`src/index.ts`](../packages/agents/src/index.ts)) serves management and
conversation RPC through one service binding. Its management methods call the functions in
`src/control-plane/workflows/`; there is no separate named Worker entrypoint. The calling Worker
authenticates its caller and passes it as `actor: { kind: 'user' | 'service' | 'agent', externalId }`,
and `AgentService` trusts it. People, services, and agents call alike: any agent can create,
rename, and configure agents, as a person can from the UI or the CLI, and no kind is refused or
limited for being that kind. An actor becomes a `principals` row on its first call, and that row
is recorded as the author of versions, the owner of agents it creates, and the actor of audit
rows; a disabled principal is refused with `forbidden:`. Roles and permissions are issue #7.

| Method                                                                           | Result                                                                       |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `getInstallationId(actor)`                                                       | lazily initialized stable installation UUID, without creating agents         |
| `seed(credentials?)`                                                             | the starting rows; `{ installId, memoryAgentId }`                            |
| `createAgent(actor, { requestId, displayName, slug?, settings?, credentials? })` | a new working agent with a server-issued UUID v7                             |
| `listAgents(actor, { kind?, status? })`                                          | registry rows, newest first                                                  |
| `getAgent(actor, agentId)`                                                       | one registry row                                                             |
| `resolveAgent(actor, ref)`                                                       | the agent a UUID, slug, or unique prefix names                               |
| `renameAgent(actor, agentId, { displayName?, slug? })`                           | the row after the change; `slug: null` removes the slug                      |
| `getConfig(actor, agentId)`                                                      | the desired version                                                          |
| `updateConfig(actor, agentId, request)`                                          | `{ version, apply }` (see [Configuration versions](#configuration-versions)) |
| `rollbackConfig(actor, agentId, request)`                                        | `{ version, apply }`                                                         |
| `configHistory(actor, agentId, page)`                                            | versions, newest first                                                       |

`createAgent` writes the registry row (`provisioning`), version 1, the caller's owner membership,
and the audit row in one batch, then initializes the object and sets it `active`. Reusing
`requestId` returns the first agent. Registry rows carry `desiredVersion`, `appliedVersion`, and
`pending`.

## Configuration

An agent's configuration is a sequence of immutable versions in the management database. The registry
asks for one, the desired version (`agents.current_version`), and the agent's object applies it and
keeps a copy ([`src/control-plane/config.ts`](../packages/agents/src/control-plane/config.ts)). Configuration is read
and written through the default `AgentService`'s [management RPC](#management-rpc).

Each version is one `AgentSettings` object, validated strictly with valibot. Every field has one
accepted shape, and unknown fields, unknown models, and unregistered tools are rejected:

```ts
interface AgentSettings {
  schemaVersion: 1
  model: { provider: string; modelId: string }
  systemPrompt: string // at most 64,000 characters
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  tools: string[] // unique names of registered tools
  webSearchRoute?: 'auto' | 'keyless' // absent means auto
  sharedSpaces: string[] // shared memory spaces read by this agent, earliest first
  description?: string // at most 1,000 characters
  labels?: string[] // up to 16 unique labels of lowercase letters, digits, or hyphens
  memoryPolicy: { extract: boolean; remember: boolean }
  credentials?: { primary: Record<string, string> }
  toolPolicy?: Record<string, 'allow' | 'deny'>
}
```

- `memoryPolicy.extract: false` stops handing new entries to the memory agent, and
  `memoryPolicy.remember: false` blocks the `remember` tool.
- `toolPolicy` blocks a denied tool at its call; a tool not listed is allowed.
- `credentials` explicitly selects credential UUIDs by Pi provider ID; grants and revocation
  are checked at use. No spend-budget configuration or cost-based enforcement exists.
- The status, display name, and slug are registry columns, not version fields.

A new agent's version 1 holds the defaults of its creation: the model `DEFAULT_MODEL_PROVIDER` and
`DEFAULT_MODEL_ID` from `cloudflare.config.ts`, the prompt `DEFAULT_SYSTEM_PROMPT` in
`src/control-plane/config.ts`, thinking off, `web_search` and `web_fetch` enabled, `sharedSpaces` `["global"]`, and both memory
policies on. Changing the defaults later changes no existing agent.

### Configuration versions

[`src/control-plane/versions.ts`](../packages/agents/src/control-plane/versions.ts) writes versions:

- `updateConfig(actor, agentId, { requestId, settings, expectedVersion, comment })` writes version
  `expectedVersion + 1`. One `batch()` inserts the version, moves `current_version`, and appends the
  audit row. The version's primary key is the optimistic lock: of two updates from the same
  version, exactly one succeeds, and the other fails with `version_conflict:` and leaves nothing
  behind. Reusing `requestId` returns the first write, even when the settings differ, so each
  intended change needs its own `requestId`.
- `rollbackConfig(actor, agentId, { requestId, toVersion, expectedVersion })` writes the content of
  `toVersion` as a new version; versions are never changed or removed.
- `configHistory(actor, agentId, { before, limit })` lists versions newest first, with author,
  comment, and time, and `getConfig(actor, agentId)` returns the desired version.

```ts
import { v7 as uuidv7 } from 'uuid'

const actor = { kind: 'user', externalId: 'you@example.com' } as const
const { version, settings } = await env.AGENT_SERVICE.getConfig(actor, agentId)
await env.AGENT_SERVICE.updateConfig(actor, agentId, {
  requestId: uuidv7(),
  settings: { ...settings, model: { provider: 'xai', modelId: 'grok-4.3' }, thinkingLevel: 'low' },
  expectedVersion: version,
  comment: 'Switch to Grok',
})
```

### Applying versions

Writing the version in D1 is the commitment; pushing it to the object is a notification that may
be lost ([`src/agent/runtime/config-apply.ts`](../packages/agents/src/agent/runtime/config-apply.ts)):

1. `AgentService` writes the version, then calls `Agent.applyConfig({ agentId, version, settings })`
   on `AGENTS.getByName(object_name)`. The call is idempotent by version number.
2. An idle object applies the version at once. A busy one holds it under `kodama:pending-config`
   and applies it when it next becomes idle, so a change made during a turn takes effect from the
   next turn, without a restart or a deploy. The idle path already runs in the object's serial
   queue and does not enter it again.
3. Applying covers every part of the version: the always-loaded memory rebuilt for its shared
   spaces, then Pi's model, prompt, thinking level, and tools, then one atomic write of the shared
   spaces, the settings (memory policy, tool policy, credentials), and the version number.
   Only then is `applied_version` reported to the registry. If any part fails, the previous version
   stays applied and reported, and the held version is retried.
4. Missed versions converge: the object compares the registry's desired version with its own when
   the harness opens, and the daily cron pushes every row where `current_version ≠ applied_version`
   again and finishes agents stuck in `provisioning`
   ([`src/control-plane/workflows/reconcile.ts`](../packages/agents/src/control-plane/workflows/reconcile.ts)). Each run takes up to 100
   agents in ID order, starting after the agent the previous run stopped at
   (`system_settings.reconcile_cursor`) and wrapping around, so agents that keep failing cannot keep
   the others from being reached.

`listAgents` and `getAgent` return `desiredVersion`, `appliedVersion`, and `pending` separately.

### Restrictions

Configuration waits for idle; restrictions do not
([`src/agent/runtime/restrictions.ts`](../packages/agents/src/agent/runtime/restrictions.ts)). The object holds a
copy of its registry state under `kodama:status`, set with `Agent.setStatus(status)`, and checks it
before every external call:

- every model request, through the `Models` the harness uses: a refused request fails without
  reaching the provider, and the turn settles `unanswered` with an `agent_restricted:` detail;
- every tool call, through a `beforeTool` hook, which also applies `toolPolicy` and
  `memoryPolicy.remember`;
- every `sendTo`.

So a restriction stops the next external call even in the middle of a turn. A state outside
`provisioning` and `active` restricts, and with no copy set yet calls are allowed. Credential
revocation, narrower permissions, and pause and delete add their checks to the same refusal.

### Models and credentials

[`src/control-plane/models.ts`](../packages/agents/src/control-plane/models.ts) registers Pi's built-in providers
and model catalogs. Provider and model IDs come from the installed Pi catalog, so updating Pi
updates the catalog.

Provider credentials live only in the management D1 vault, envelope-encrypted with a per-row
DEK wrapped by the single `CREDENTIAL_KEK_V1`. Configuration carries credential UUIDs,
never values. `AgentService` methods register, assign, revoke and replace both credential kinds;
any registered agent may call them, with its identity recorded in audit. See
[credentials.md](credentials.md) for authorization, auditing, cache bounds and the KEK runbook.

Working agents and the memory agent use the same D1 `CredentialStore`. Resolution uses the
version's sole provider reference and requires a usable grant. Missing, revoked, unassigned, or
`needs_reauth` credentials stop the request with `credential_unavailable`. OAuth credentials inside
Pi's five-minute preemptive window refresh under the D1 row lease; the holder rechecks the current
row so concurrent resolutions refresh only once. Terminal refresh errors persist `needs_reauth`
with an audit row; transient failures stop the request without invalidating the credential. Creation
and configuration updates validate assignments; `sendMessage` checks authentication before admitting
input. No environment variable, local credential file, shared default, or implicit provider fallback
is consulted.

Pi's catalog supplies additional providers without new secret bindings. The local CLI supports
interactive ChatGPT login and encrypted registration; see [Local agent CLI](#local-agent-cli).
The ChatGPT refresh request and response contract, including RFC and provider-specific error
classification, is documented in [OAuth refresh contract](credentials.md#oauth-refresh-contract).

The memory agent's model is set by its versions like any agent's. `MEMORY_MODEL_PROVIDER` and
`MEMORY_MODEL_ID` only give the seed's version 1; when they are empty, it uses the default model.

### Tools

To add a tool:

1. Implement it in `src/tools/`, in a lowercase hyphenated file such as `current-time.ts`.
2. Register it in [`src/tools/index.ts`](../packages/agents/src/tools/index.ts).

Agents enable registered tools by name in `tools`. New working agents default to `web_search`
and `web_fetch`; an explicit applied `tools: []` disables optional tools. Optional tools are
`current_time`, `contact_agent`, `web_search`, and `web_fetch`. The memory tools come from the memory
extension, not from this list. `contact_agent` is bound only in a working agent's registry; the memory agent neither
registers it nor permits `sendTo`.

Locally, `nr agent tools assistant current_time contact_agent` replaces the optional tool selection
through the versioned configuration API, preserving the other settings and credential references.
Omit tool names to disable all optional tools.

## RPC contract

[`AgentService`](../packages/agents/src/index.ts), the Worker's default export, validates agent IDs
at the boundary, admits them from the registry (see [Registry and admission](#registry-and-admission)),
and forwards to the agent's Durable Object:

| Method                                         | Result                                       |
| ---------------------------------------------- | -------------------------------------------- |
| `send(agentId, { requestId, content })`        | SSE response through terminal submission     |
| `subscribe(agentId)`                           | Continuous agent-wide SSE observation        |
| `sendMessage(agentId, { requestId, content })` | Durable acceptance with `submissionId`       |
| `submission(agentId, requestId)`               | Submission status, or `undefined`            |
| `snapshot(agentId)`                            | Committed user/assistant messages and `busy` |
| `cancel(agentId)`                              | Stop current work; resolves once idle        |

`AgentService` cannot reach the memory agent: it admits only working agents. The Agent object has a
few more methods, for other Durable Objects and for `AgentService`:

| Method                          | Caller       | Effect                                                         |
| ------------------------------- | ------------ | -------------------------------------------------------------- |
| `sendTo(agentId, message)`      | an agent     | deliver to another agent; returns once the target admits input |
| `applyConfig(pushed)`           | AgentService | apply a configuration version now, or hold it until idle       |
| `setStatus(status)`             | AgentService | set the object's copy of its registry state                    |
| `getConfig()`                   | tests, tools | the applied configuration as Pi holds it                       |
| `readEntries({ after, limit })` | memory agent | conversation text after an entry, from Pi or from the archive  |
| `memoryChanged()`               | memory agent | refresh the always-loaded memory now, or when next idle        |
| `prune({ force })`              | maintenance  | archive and delete old entries                                 |
| `enqueue(job)`, `jobStatus(id)` | agents       | queue a memory job and read its status (memory agent only)     |
| `consolidate(now)`              | cron         | the daily consolidation (memory agent only)                    |

### IDs, limits, and retries

- Agent IDs are lowercase UUIDs from the registry. Request IDs are 1–128 letters, digits, `_`, or
  `-`.
- Messages must be nonblank and at most 16,000 characters. Invalid input throws a `TypeError`
  ([`src/validation.ts`](../packages/agents/src/validation.ts)).
- Request IDs are scoped to the receiving agent's root conversation. To retry a delivery, reuse the
  same request ID and content; a completed retry returns the first result without running the
  model again. Use a new request ID for a new turn. The content of a retry is not compared: a
  reused request ID returns its first submission even when the content differs, and the new
  content is dropped without an error. Generate a fresh ID, such as a UUID v7, for every message,
  and never derive it from a conversation or session alone.
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
import { v7 as uuidv7 } from 'uuid'

await env.AGENT_SERVICE.sendMessage(agentId, {
  requestId: uuidv7(),
  content: 'Prioritize the failing tests.',
  whenBusy: 'steer',
})
```

### Submissions and snapshots

`submission(agentId, requestId)` reports the status of one input:

- `done` means an answer was committed; `answerEntryId` identifies that input's exact answer;
- `unanswered` means generation produced no answer. Its `reason` (for example `model_error`) and
  text `detail` (such as the provider's message) say why.

Other Pi submission states are kept in the typed result.

`snapshot()` returns committed user and assistant text, plus whether the agent is busy.

### Cancel

`cancel(agentId)` stops the current run, including an in-flight model request or a retry wait, and
withdraws queued input. Those submissions settle as `unanswered`, and open `send()` streams close
with that receipt. History and configuration are kept, so a held configuration version applies and
new messages work right after.

### Agent to agent

`Agent.sendTo(targetId, message)` checks this agent's restrictions, admits the target from the
registry, and calls `sendMessage` on its object, which checks target credentials. It acknowledges
durable admission without waiting for the target model. The receiver persists a
`kodama.agent-message` input with sender UUID and hop count; the same provenance is visible in the
message text. Peer input is always queued as `followUp`, never injected into an unrelated active
turn. Self-contact is refused.

The opt-in `contact_agent` tool accepts `target` (UUID, slug, or unique UUID prefix) and `message`.
Its workflow in `src/tools/contact.ts` resolves the registry reference and calls this same `sendTo`
path. It polls the request-specific submission for at most 30 seconds after acceptance, then reads
the exact `answerEntryId`, not the latest unrelated assistant message. Results distinguish
`answered`, terminal `unanswered`, and accepted `pending`; a pruned answer is explicitly marked
unavailable. Timeout or sender cancellation does not cancel the receiver. Pending is not a reason
to resend the question. The tool is replay-unsafe: recovery does not silently repeat external
delivery. Its delivery request ID is scoped to the sender and tool task.

Receiving a peer message or sending a peer request establishes permanent external contact for
that root; a new owner message, steering, compaction, cancellation or eviction never clears it.
Contact stops `remember` but not peer delivery: a contacted agent may still use `contact_agent`,
and the receiver treats the message as peer data and establishes its own contact.
`MAX_CONTACT_HOPS = 3` bounds how far a chain started by one input can forward. Delivery commits
sender contact before crossing the object boundary and never holds its serial queue while
waiting on another object.

## Public web tools

New working agents enable `web_search` and `web_fetch`; explicit applied `tools: []` disables
both. Reopening reconciles the optional-tool complement from the applied immutable settings,
not the desired version. Missing applied settings fail closed; policy deny wins. Memory tools
remain separately registered and system agents never receive web tools. Both web adapters are
replay-unsafe: interrupted traffic is accounted for, never automatically repeated.

Search accepts only `{query}`. In auto mode the applied model's provider/API and exact official
base select OpenAI/xAI Responses, Anthropic Messages, DeepSeek's explicit catalog-completions
to Messages adapter, or Gemini GenerateContent SSE. The same model ID is retained. Unsupported
provider/API/base combinations and explicit `webSearchRoute: 'keyless'` select anonymous search
before sending. Native errors never retry, fall back, or change a later call's route. Native API
keys may incur inference and search charges; there is no budget or billing approval mechanism.

Keyless order is Exa → Firecrawl → Parallel → Tavily, skipping in-memory cooldowns. Only verified
HTTP 429 responses rotate. Concurrency caps, 60-second rolling rate windows, keyless 429 provider
cooldowns, and Parallel's session reuse are kept in memory per `Agent` Durable Object (`WebState`).
Tool calls, returned envelopes, and error results are recorded directly by Pi Durable in its own
`entries` transcript (and archived to R2 on prune), so `kodama_usage`, `usage_daily`, and
`audit_log` remain model-invocation and management ledgers without duplicate tool rows. Shared
egress means even the first request can be limited. `retryAt` is a best-effort
indication, not quota availability or permission to retry. Fixed anonymous protocols remain
owner-live verification gates, not claims of confirmed service availability.

Fetch accepts `{url, max_chars?}` and returns inert HTML/plain/Markdown text, not a browser.
Lexical URL checks allow only HTTP(S), standard ports and no userinfo/IP/internal names. Up to
three redirects are checked individually; loops and HTTPS downgrade fail. There is no DNS preflight,
JS, subresource loading, login, cookies, page-link permission harvesting or arbitrary headers.
`global_fetch_strictly_public` controls same-zone routing to the public front door rather than
the zone origin; it does not enforce connection-time public egress. The code-level URL guards
are lexical only. Resolved-destination and DNS-rebinding safety remain an owner-only live
verification release gate, not protections proven by the flag or local URL fixtures.

Each call has a cancellable 15-second deadline beginning before scoped vault auth. Per object,
at most two calls (one keyless) run concurrently; rolling 60-second limits are 10 search
admissions, 30 fetch admissions and 10 actual anonymous sends. Native responses are bounded to
512 KiB; anonymous attempts to 256 KiB/5 seconds with a 512 KiB total; fetch transfer/decoded text
to 2 MiB. Envelopes are valid JSON ≤128 KiB marked `untrusted_external_data`, not instructions.

Immediately before the first outbound web send, SQLite atomically commits first contact with
the admission. Failed traffic never clears contact, and contact does not stop research or ask
anyone for approval. The rules after it guard the two ways a call can carry data out, not the
act of reading:

- `web_search` stays available, but its query may not contain a URL (`query_contains_url`): a
  scheme with `://`, or a host followed by a path, query or fragment. A provider's own search
  may open such a URL. A bare domain, as in a `site:` filter, is allowed.
- `web_fetch` reaches only a known URL (`unverified_url`): one written in an owner message,
  returned by a successful search, or linked from a fetched page. A URL the model composed or
  edited cannot be fetched, so it cannot carry context data to an attacker's server.

Both refusals return a `hint` (search with words, then fetch a result), so a long-running agent
finds another route instead of stopping.

Known URLs live in `kodama_known_urls`, per root and not consumed, so a page stays readable on
later turns and after eviction. Owner URLs are taken from the message text when `sendMessage`
admits it, so a UI only sends what the user typed; peer messages add none. Search sources (at
most 20 per search) are recorded after the search succeeds. A fetched page returns `links`: at
most 50 public links, normalized and resolved against the final URL, from anchors outside
removed navigation and hidden subtrees, or from URLs written in a plain-text page; they are
recorded after the fetch. Links longer than 500 characters are dropped, model output adds no
known URL, and redirects add none. The newest 1,000 known URLs per root are kept; granting one
again refreshes it.

A non-removable system section marks web, peer and history content as evidence, not approval.
Read tools, the web tools under these rules, peer delivery and final answers remain available
after contact; `remember` does not. Wrong answers, persuasion, which known URL or link the model
chooses to fetch (an attacker's page can offer many links), and what a search query discloses
to the search provider remain residual risks. Known URLs are authorization, not sanitization.

All five native routes have mocked transport/schema fixtures, not universal model compatibility
claims. The owner personally must verify real native dialect/auth/grounding, anonymous endpoints
and Workers egress in an environment the owner deploys. Agents do not deploy or run live checks.
Google native search is required. Google display (viewer, suggestions rendering, retention,
cleanup and browser tests) is explicitly out of scope, not passed; suggestion HTML is discarded
and is neither a readiness prerequisite nor model/ledger content.

## Events

[`src/agent/runtime/events.ts`](../packages/agents/src/agent/runtime/events.ts) turns Pi's observation API into SSE byte
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

A Durable Object has one alarm. [`alarms.ts`](../packages/agents/src/agent/runtime/alarms.ts) stores one due
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

On wake, Kodama opens the harness and enables Pi's scheduler. Pi Durable reconstructs pending
tasks and handles their checkpoints, provider retries, and submission deduplication. Its
Cloudflare adapter only supplies SQLite storage; it does not schedule platform alarms or wake
an evicted object. Kodama therefore retains the wakeup alarm, not a second task-recovery engine.
When no task is left, recovery clears only its own time and runs the idle work: scheduling
extraction and pruning, and any pending memory refresh. Reopening an idle object preserves an
already scheduled extraction deadline, including one that is due. Admission persists pending
extraction activity and clears the previous idle deadline; when the new work finishes, extraction
gets a fresh ten-minute delay. Successful extraction handoff clears that pending activity and its
deadline. Without new input, later recovery or eviction does not schedule another extraction.

Model calls can be repeated after an interruption. Request IDs prevent duplicate durable inputs,
not duplicate provider billing.

## Storage in the Durable Object

Each object's SQLite holds two sets of tables:

- **Pi Durable's tables**: entries, tasks, documents, submissions, and their metadata. Pi creates
  and migrates them. Pruning deletes old rows through the column definitions in
  [`src/agent/local-db/pi-tables.ts`](../packages/agents/src/agent/local-db/pi-tables.ts), which must be checked
  on every Pi upgrade.
- **Kodama's tables**, prefixed `kodama_`, defined in
  [`drizzle/durable-object/schema.ts`](../packages/agents/drizzle/durable-object/schema.ts): model
  invocation usage (`kodama_usage`), the memory agent's job queue (`kodama_memory_jobs`), the
  `remember` count per turn (`kodama_remember_turns`), the always-loaded memory copy
  (`kodama_always_loaded`), pruning runs (`kodama_prune_runs`), permanent external contact
  (`kodama_external_data`), and the known URLs fetch may reach after it (`kodama_known_urls`). Their
  migrations are generated into `drizzle/durable-object/migrations` and applied by
  `src/agent/local-db/local.ts` before the harness opens.

Small values use the object's key-value storage under `kodama:` keys: alarm times, prune limits,
shared spaces, the applied configuration (`kodama:config-version`, `kodama:applied-settings`,
`kodama:agent-id`), a held version (`kodama:pending-config`), and the state copy (`kodama:status`).

## Development

Issue #26's local SQLite migration (`0003`) adds only `kodama_external_data` and
`kodama_web_permissions` for permanent external contact and atomic one-shot permissions;
migration `0004` replaces the permissions with `kodama_known_urls`
(see [Public web tools](#public-web-tools)); web
rate limits/cooldowns are held in memory and tool execution logs rely on Pi Durable's own
`entries` table rather than extending `kodama_usage` or management D1. Existing development state is disposable; start
with fresh local state when resetting local databases. Current-runtime persistence, permanent external contact,
atomic permissions, and interruption recovery remain required.

Use Node.js >=22.19 and pnpm 12.14.0 through the `ni`/`nr` wrappers:

```sh
ni
cp packages/agents/.dev.vars.example packages/agents/.dev.vars
# Set only CREDENTIAL_KEK_V1 to base64 of 32 random bytes; keep it across restarts.
# Never store provider API keys in .dev.vars; register them through the CLI below.
nr dev:agents
```

`nr dev:agents` first applies both D1 databases' Drizzle migrations locally, then runs `cf dev`,
which starts the Vite-powered Worker with local D1, R2, and Durable Objects. It exposes RPC, not a
browser page. `cli/migrate.ts` uses Vite's `.wrangler/state/v3` persistence root and the binding
names as local D1 IDs. It requires no Cloudflare account or remote database ID; `cf d1 list --local`
uses a different local resource catalog and is not needed. Repeated starts preserve existing data,
and migration failure prevents the Worker from starting. Stop the dev server before restarting it
so only one process is using its local storage.

| Command                                                | Effect                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| `nr check`                                             | TypeScript, type-aware Oxlint, Oxfmt check, and tests                     |
| `nr test`                                              | workspace tests                                                           |
| `nr format`                                            | format the repository                                                     |
| `nr build` (in `packages/agents`)                      | `cf build` into `.cloudflare/output/v0/`, no deploy                       |
| `nr cf:types` (in `packages/agents`)                   | regenerate runtime types                                                  |
| `nr db:generate:memory` (in `packages/agents`)         | write a D1 migration after `drizzle/memory/schema.ts` changes             |
| `nr db:generate:durable-object` (in `packages/agents`) | write a local migration after `drizzle/durable-object/schema.ts` changes  |
| `nr db:generate:management` (in `packages/agents`)     | write a management migration after `drizzle/management/schema.ts` changes |

### Local agent CLI

With `nr dev:agents` running, send messages from another terminal at the repository root:

```sh
# Read an explicitly exported environment variable; never pass the key itself as an argument.
nr agent credentials add --provider openai --key-from-env OPENAI_API_KEY
# Or read the key from a protected file on stdin:
nr agent credentials add --provider openai < /secure/path/openai-key
nr agent credentials list
# Alternatively, run credentials login --provider openai before seed.
# Use the credentialId returned by registration or login:
nr agent seed --credential <credential-id>
nr agent create second --name "Second agent" --credential <credential-id>
nr agent list
nr agent send assistant "Hello!"
nr agent send second "Hello from the second agent!"
nr agent snapshot second
# Alternative authentication: complete Sign in with ChatGPT in your browser.
nr agent credentials login --provider openai
# Switch existing agents explicitly to the newly returned OAuth credentialId:
nr agent credentials assign <oauth-credential-id> assistant
nr agent credentials assign <oauth-credential-id> second
# For memory, use its UUID from `nr agent list`:
nr agent credentials assign <oauth-credential-id> <memory-agent-uuid>
# Revoke the previous credential only after replacing every reference:
nr agent credentials revoke <old-credential-id>
nr agent send assistant "Continue the conversation."
nr agent snapshot assistant
nr agent cancel assistant
nr agent send assistant "Hello!" --request-id my-test-1
nr agent send assistant "Change direction." --steer
nr agent send assistant "Hello!" --events
nr agent --help
```

The CLI works like this:

- `<agent>` is a UUID, a slug, or a unique UUID prefix. `seed` creates the first agent, slug
  `assistant`. `create` uses current server defaults; its display name defaults to its slug.
  Fresh agents require explicit `--credential ID` references for their model providers; repeat the
  option once per provider when defaults differ. No credential is automatically selected. Repeated
  seed preserves existing agents and can omit the references when nothing needs creating.
  `list` includes every registered working and dedicated agent, with its UUID, optional slug,
  display name, status, and desired/applied configuration versions. Results are JSON.
- Credential registration is write-only. Listing returns only metadata (ID, kind, provider, status,
  fingerprint, last4 and timestamps), never key or token values. Assign/unassign update configuration
  through the existing management RPCs; revoke immediately prevents further resolution. Configure
  `CREDENTIAL_KEK_V1` in the local Worker before registration; the CLI never manages Worker Secrets.
  `.dev.vars` must contain only the KEK and non-secret local settings, never provider API keys.
  The CLI does not load credentials from `.dev.vars`: supply a temporary key variable in your
  shell or pipe a key from a protected source, then register it into the encrypted local store. Never paste keys into command-line arguments or shell history.
- `credentials login --provider openai` calls Pi `Models.login` on Node with an in-memory store,
  a lazily initialized installation ID and agent name `kodama`. It prints the authorization URL, then accepts
  the final redirect URL without echoing it. The browser callback uses `127.0.0.1:1455`; if that port
  is occupied, cancel the other login first. A remote browser can paste the full redirect URL back
  into the CLI. Login validates the issued client ID and `chatgpt.tokens.use.direct` scope, then
  registers an `oauth_subscription` through the same write-only endpoint. No `auth.json` is written.
  Login never seeds agents: pass the returned ID to `seed --credential ID` or `create --credential ID`,
  or assign it to an existing agent. Registration itself also lazily initializes identity, without
  creating agents. Browser completion requires the owner; automated tests
  exercise Pi's real authorization/manual-redirect flow with a mocked token endpoint.
- `dev seed-credentials < /secure/path/provider-keys.json` remains a bootstrap shortcut: the JSON
  maps provider IDs to keys, which are encrypted into local D1 and assigned to working and memory
  agents. To assign memory separately, use its UUID from `list`. Keep input files outside the
  repository with mode 0600.
- The same agent keeps its conversation in local Durable Object storage.
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
needed. `vitest.worker.config.ts` reads the generated migrations of both D1 databases for the setup.
It also passes the columns from the drizzle-kit snapshots, so a test fails when a schema and its
migrations differ. `vitest.config.ts` runs this project alongside a Node project for the CLI
entrypoint and token filesystem tests. Both projects run with `nr check` and share the Istanbul
coverage report from `nr test:coverage`. The entrypoint tests mock token access and HTTP transport,
not argument parsing or stream output; the token tests use temporary directories and remove them.

Tests sit next to the module they test, as `<module>.test.ts` in the same folder. Shared helpers
are in `src/testing/`, which production code never imports, and `vitest.setup.ts` applies the D1
migrations before the tests.

Check a Durable Object method that rejects inside the object with `rejectionInObject`
(`src/testing/rpc.ts`): under the Vitest plugin, an RPC to an object that rejects leaves it with an
active reference, and a later `evictDurableObject` on it times out. Public RPC rejection tests are
retained, but currently emit unhandled-rejection and request-cancellation diagnostics under the
plugin; see [workers-sdk #14736](https://github.com/cloudflare/workers-sdk/issues/14736). These
logs are not suppressed, and a passing assertion does not mean this runtime issue is resolved.
The current risk assessment permits these known diagnostics: a deliberately incorrect rejection
assertion still fails the suite with exit code 1, and the local dev Worker rejects an unknown-agent
management RPC without these diagnostics and continues serving snapshot, cancel, and seed calls.
This is evidence for the tested paths, not a guarantee about every RPC failure. Do not generalize
this allowance to new errors or timeouts; keep rejection assertions and the object-eviction tests.

| Path                                         | Contents                                                      |
| -------------------------------------------- | ------------------------------------------------------------- |
| `src/testing/model.ts`                       | mocked OpenAI Responses streams: text, tool calls, inspection |
| `src/testing/rpc.ts`                         | a scripted model, `waitForAnswer`, SSE readers, rejections    |
| `src/testing/conversation.ts`                | a long conversation that compacts, for pruning tests          |
| `src/testing/memory.ts`                      | the memory database, records, and the memory agent            |
| `src/testing/management.ts`                  | the seed, the owner, registry rows, and configuration changes |
| `src/control-plane/workflows/agents.test.ts` | creation, renames, listing, versions, conflicts, rollback     |
| `src/control-plane/workflows/seed.test.ts`   | the seed, the first agent, the memory agent's versions        |
| `src/control-plane/registry.test.ts`         | admission without object storage, and resolving references    |
| `src/control-plane/principals.test.ts`       | every kind of caller as a principal and actor; disabled ones  |
| `src/control-plane/db.test.ts`               | the D1 behaviors the management database relies on            |
| `src/agent/runtime/config-apply.test.ts`     | applying at idle, convergence, partial failures, restrictions |
| `src/index.test.ts`                          | the entrypoint's HTTP refusal and the daily cron              |
| `src/agent/agent.test.ts`                    | the Agent RPC and input validation                            |
| `src/agent/runtime/events.test.ts`           | `send` and `subscribe` streams                                |
| `src/agent/runtime/alarms.test.ts`           | alarm purposes; failures, cancellation, and recovery          |
| `src/control-plane/config.test.ts`           | the settings schema, and versions applied across eviction     |
| `src/control-plane/models.test.ts`           | provider credentials                                          |
| `cli/*.test.ts`                              | the CLI's commands, token, stream output, and adapter Worker  |
| `drizzle/*/schema.test.ts`                   | each schema matches its generated migrations                  |

The memory tests are listed in [memory.md](memory.md#testing). Name every test file
`<module>.test.ts` after the module it tests, in the same folder; describe the observable behavior it checks, and run `nr check` before submitting.

## Deployment

From `packages/agents`:

1. Log in with `nr cf auth login`.
2. Create the D1 databases `kodama-memory` and `kodama-management` and the R2 bucket
   `kodama-archive` that `cloudflare.config.ts` binds.
3. Find the database IDs with `nr cf d1 list`; the pinned CLI requires IDs, not database or
   binding names. Apply the migrations with
   `nr cf d1 migrations apply <memory-database-id> --dir drizzle/memory/migrations` and
   `nr cf d1 migrations apply <management-database-id> --dir drizzle/management/migrations`, then
   check that `nr cf d1 execute <management-database-id> --command "PRAGMA foreign_keys"` returns 1.
4. Provision `CREDENTIAL_KEK_V1` externally as a base64-encoded random 32-byte key. The Worker
   reads it only; it cannot manage Worker Secrets. See the operational policy in
   [credentials.md](credentials.md); provider keys are never Worker secrets.
5. Deploy with `nr deploy`.
6. Through the trusted RPC boundary, register the credential with `putCredential`, then call
   `AgentService.seed({ primary: { openai: credentialId } })`; it is idempotent.
   Supply references for each configured default/memory provider. No owner role is required;
   the local registration adapter is not deployed.

The Worker exports one Durable Object class, `Agent`, with SQLite storage, bound as `AGENTS`; the
memory agent is an object of it (see [Dedicated agents](#dedicated-agents)). It also exports the
single default entrypoint `AgentService` for conversation and management RPC. Its cron trigger (`17 3 * * *`, UTC) reconciles configuration
versions, ingests usage from registered objects, then runs the daily memory consolidation. `workersDev` is disabled.
This repository uses `cf`, `cloudflare.config.ts`, and the Cloudflare Vite plugin; Wrangler is only
a transitive dependency.

## Usage and audit reads

The same `AgentService` exposes `usage(actor, query)` for daily per-agent/per-credential catalog
amounts and `audit(actor, query)` for descending, cursor-paged management events. Both require an
active registered caller; they do not introduce a second administration service or owner-only ACL.
Credential summaries include effective expiry, daily-ingested last use, committed refresh time and
safe refresh failure health, without decrypting secrets during reads. See [usage.md](usage.md) for
attribution, aggregation and completeness, and [credentials.md](credentials.md#usage-audit-and-credential-health)
for audit pagination, event semantics and health fields. Management audit and daily totals remain
in D1 indefinitely; acknowledged local usage detail expires after 30 days. No audit R2 export runs.

## Connecting a UI

A future `packages/ui` server Worker binds to the exported config, which keeps the RPC types:

```ts
// packages/ui/cloudflare.config.ts
import agents from '@kodama/agents/config'
import { bindings } from 'cf/config'

const agentBinding = bindings.worker({ worker: agents.worker })
// env: { AGENT_SERVICE: agentBinding } — conversation and management, with no D1 binding
// await env.AGENT_SERVICE.listAgents(actor)
```

```ts
import { v7 as uuidv7 } from 'uuid'

// A server-side chat route, after authenticating the user and checking access to the agent:
const stream = await env.AGENT_SERVICE.send(agentId, {
  requestId: uuidv7(),
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
- Only the agents Worker binds D1. The UI Worker never binds a D1 database; it reaches the
  registry and configuration through `AgentService`, which checks principals on management calls
  other than `seed`.
- `AgentService` admits only registered working agents, so an unknown or mistyped ID never creates
  an object.
- Provider credentials are encrypted D1 rows, outside settings and RPC results. Only
  `CREDENTIAL_KEK_V1` is a Worker secret. Never commit `.dev.vars`, credentials or generated local
  state.
- Outputs and stored content are not redacted: credentials are supplied only for provider
  authentication, not model context or result fields. Provider output streams without a redaction
  buffer. Do not paste secrets into ordinary content. Credential background logs contain categories,
  not raw exception objects (see [credentials.md](credentials.md#leak-prevention-boundaries)).
- Untrusted RPC input is validated with valibot at the boundary.
- A shared space accepts only records that two agents
  keep (see [memory.md](memory.md#shared-memory)).

## References

- [Pi Durable on Cloudflare](https://earendil.com/posts/pi-durable-on-cloudflare/)
- [Pi Durable spec](https://github.com/earendil-works/pi/blob/main/packages/durable/docs/spec.md)
- [Cloudflare cf CLI](https://blog.cloudflare.com/cloudflare-cf-cli-launch/)
- [Cloudflare RPC](https://developers.cloudflare.com/workers/runtime-apis/rpc/)
- [Durable Objects SQLite storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
