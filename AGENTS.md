# Repository Guidelines

## Project Structure & Module Organization

Kodama runs Pi Durable agents on Cloudflare Durable Objects, with one SQLite-backed object per agent ID. The pnpm workspace currently contains `packages/agents`; `packages/ui` is planned, not implemented.

- `packages/agents/src/index.ts`: service-binding RPC entrypoint (`AgentService`, which admits only registered working agents by UUID), and the re-export of `ManagementService`.
- `packages/agents/drizzle/`: every Drizzle schema, next to the migrations drizzle-kit generates from it, one folder per database. There are two D1 databases. `memory/` is long-term memory (`kodama-memory`, bound as `MEMORY_DB`): `memory/schema.ts` is its schema and `memory/migrations/` its migrations (apply them with `cf d1 migrations apply kodama-memory --dir drizzle/memory/migrations`). `management/` is the management database (`kodama-management`, bound as `MANAGEMENT_DB`): the agent registry, configuration versions, principals, members, settings, and audit, with `management/schema.ts` and `management/migrations/` (apply them with `cf d1 migrations apply kodama-management --dir drizzle/management/migrations`). `durable-object/schema.ts` is kodama's tables in each Durable Object's own SQLite, and `durable-object/migrations/` their migrations, which `src/storage/local.ts` applies. Keep one schema file per SQLite database. Edit the schemas by hand; never edit the `migrations/` folders.
- `src/lib/`: generic helpers that import nothing else from `src/` (`hash.ts`, `search-text.ts`, `uuid.ts`, `errors.ts`, and `serial.ts`, the ordering helpers the `Agent` class uses).
- `src/management/`: the management database through Drizzle: `db.ts` the handle, `registry.ts` registry rows, admission, and resolving references, `versions.ts` configuration versions, `lifecycle.ts` lifecycle states and their moves, `principals.ts` the caller as a principal, `audit.ts` the audit row. It knows nothing of objects.
- `src/management/service/`: `ManagementService`, the named entrypoint for managing agents (`index.ts`), its flows (`agents.ts`: create, list, rename, versions, pushing to objects), the seed (`seed.ts`: the memory agent's registry row and the first agent, a general-purpose assistant), and daily reconciliation (`reconcile.ts`). It sits at the top with the entrypoint; the rest of `src/management/` does not import it.
- `src/runtime/`: the `Agent` Durable Object (a working agent) and the shared runtime for working and system agents. `agent.ts` only wires the parts and serves RPC; put behavior in its own module there (`harness.ts` opening the harness and its exclusive section, `alarms.ts` the shared alarm and recovery, `events.ts` SSE streams, `memory.ts` the agent's memory refresh, extraction, and pruning control, `views.ts` snapshot and submission reads mapped from Pi state, `config-apply.ts` applying or holding configuration versions, `restrictions.ts` the checks before every external call) or under `src/memory/`, not in `agent.ts`.
- `src/agent-object.ts`: exports `AgentObject`, the one Durable Object class (exported as `Agent`), whose constructor selects a working agent or the system agent registered for the object's name in `DEDICATED_AGENTS`.
- `src/system-agents/`: internal agents that support Kodama, implemented as `Agent` subclasses in the same `AGENTS` namespace under reserved names. They retain `kind = 'dedicated'` in the registry and are unreachable through the working-agent RPC. Never add a Durable Object class or binding for a system agent; add a folder, a reserved name with `:`, and a `DEDICATED_AGENTS` entry in `src/agent-object.ts`.
  - `memory/`: the memory agent, and only what it adds to an agent: `agent.ts` the `MemoryAgent` class, which extends `Agent`, overrides its protected hooks, and adds the job methods; `config.ts` its model, configuration, harness options, tool set, and prompts; `queue.ts` its job queue; `runner.ts` enqueueing, the drain, retries, and consolidate. Its tools and consolidation are memory parts under `src/memory/`.
- `src/validation.ts`: valibot schemas for untrusted RPC input; failures throw `TypeError`.
- `src/configuration/`, `src/models/`, and `src/tools/`: configuration (the settings of a version, their validation and defaults, with the default prompt and shared spaces, and the parts an object applies), providers, and registered tools.
- `src/memory/`: long-term memory, one folder or file per part. Keep each file to one concern; split a file before it grows past a few hundred lines, but do not split one that small.
  - `store/`: D1 through Drizzle, with the schema in `drizzle/memory/schema.ts`. `records.ts` applies write operations, `record-plans.ts` and `progress-plans.ts` plan them, `statements.ts` holds the statements they share, `search.ts` searches records. Write queries with Drizzle's query builder and migrations only with drizzle-kit; do not write SQL by hand.
  - `tools/`: the memory agent's tools (records and `shared_write`, skills, entries and archive summaries, and what they share in `common.ts`).
  - `consolidation.ts`: daily consolidation: retention, skill curation, and the consolidate jobs it queues.
  - `working/`: what working agents get: the always-loaded memory, the memory tools, and the extension.
  - `archive/`: archived segments in R2 (`segment.ts` writes, `reader.ts` reads) and `history_search`.
  - `prune/`: pruning of old Pi entries: limits, runs, the steps before the delete, and the delete.
  - `skills.ts`: agent skills, one D1 row each with its body: writing, archiving, listing, reading, and curation.
  - `shared.ts`: checked writes to shared spaces (two agents' records, or the space's own).
  - `jobs.ts`: the memory agent's input contract; `transcript.ts`: the text of Pi entries and paged entry reads.
- `src/storage/`: opening kodama's tables in each Durable Object's own SQLite (`local.ts`; the schema is `drizzle/durable-object/schema.ts`) and `pi-tables.ts`, Pi Durable's tables as pruning reads them; re-run `src/memory/prune/prune.test.ts` and `src/storage/pi-assumptions.test.ts` on every Pi upgrade.
- `src/protocol.ts`: transport types; consumers should use type-only imports.
- Tests sit next to the code they test, as `<module>.test.ts` in the same folder (for example `src/runtime/agent.test.ts` for the Agent RPC and `src/memory/prune/prune.test.ts` for pruning); `drizzle/schema.test.ts` checks the schemas against their migrations. Shared test helpers are in `src/helper/` and the Vitest setup is `vitest.setup.ts`; production code never imports either.
- `packages/agents/cloudflare.config.ts`: Worker bindings (`AGENTS`, `MANAGEMENT_DB`, `MEMORY_DB`, `ARCHIVE`), the named entrypoint `ManagementService`, secrets, and SQLite configuration.

The abbreviated `src/` paths above are relative to `packages/agents/`.

Keep the code functional and simple. Classes exist only because a Durable Object or a Worker entrypoint (`AgentService`, `ManagementService`) must be one: `Agent`, its dedicated subclasses such as `MemoryAgent`, and `AgentObject`, which picks between them. They hold the object's in-memory state in private fields; a subclass changes behavior only through `Agent`'s protected hooks, and a method only it serves is declared on `Agent`, which rejects it. Write everything else as plain functions that take what they need (`db`, `local`, `harness`, `env`) and return a result; do not add classes, or objects that only carry dependencies, to organize code. Prefer fewer, cohesive files over many small ones, and the simplest storage that stays correct after a stop (for example one D1 batch rather than a journal over R2). Add a mechanism only when the feature needs it now.

Imports follow the layers in `docs/agents.md` (Dependencies): `lib` imports nothing else from `src/`, the memory parts never import `src/runtime/` or `src/system-agents/` (they use `src/memory/jobs.ts`), and `src/system-agents/` sits above `src/runtime/`, including `src/runtime/agent.ts`; the runtime never imports system agents. `src/agent-object.ts` selects between them at the composition boundary. `src/management/` outside `service/` imports no agent code, and `src/management/service/` sits at the top with the entrypoint. The memory agent is a `MemoryAgent` object in the `AGENTS` namespace, not its own Durable Object class or binding. Put new code in the lowest layer it fits.

`docs/agents.md` explains the runtime and `docs/memory.md` long-term memory. File comments cite
their sections by name, so keep the headings and the code in step when either changes.

## Build, Test, and Development Commands

Use Node.js >=22.19 and the pinned pnpm 12.14.0 through `ni`/`nr` wrappers.

- `ni`: install workspace dependencies.
- Copy `packages/agents/.dev.vars.example` to `packages/agents/.dev.vars` and populate provider credentials.
- `nr dev:agents`: start the local Worker; it exposes RPC, not a browser page.
- `nr agent seed`, then `nr agent send assistant "Hello"`: create the starting rows, then send to the first agent by its slug through the development adapter to Durable Object RPC; see `nr agent --help` for history and cancellation.
- `nr check`: run TypeScript, type-aware Oxlint, Oxfmt checks, and tests.
- `nr test`: run workspace tests.
- `nr format`: format the repository; review resulting changes.
- From `packages/agents`, `nr build` builds without deploying, and `nr cf:types` regenerates runtime types.
- From `packages/agents`, `nr db:generate:memory` writes a D1 migration after `drizzle/memory/schema.ts` changes, `nr db:generate:management` one after `drizzle/management/schema.ts` changes, and `nr db:generate:durable-object` a local migration after `drizzle/durable-object/schema.ts` changes (add it to `src/storage/local.ts`); tests fail when they differ.

## Coding Style & Naming Conventions

Use strict TypeScript with two-space indentation, single quotes, no semicolons, trailing commas, and a 100-column formatting width. Oxfmt controls formatting; Oxlint enforces type safety. Use type-only imports and handle promises explicitly. Avoid `any`, unsafe assertions, and non-null assertions.

Document with TSDoc: every file opens with a module comment ending in `@module`, and every export has a `/** */` comment that states intent and non-obvious constraints without restating the types. Cite the docs with `@see docs/memory.md — Section`, and use `@param name - text`, `@returns`, `@throws {@link TypeError} When …`, and `@remarks` only where they add something.

Follow existing camelCase functions, PascalCase types/classes, and lowercase hyphenated filenames such as `current-time.ts`. Write comments and repository documentation in English.

## Testing Guidelines

Use Vitest with the Cloudflare plugin in workerd. Put each test next to the module it tests as `<module>.test.ts` (not in a separate `test/` folder) and describe observable behavior. Put shared mocks and helpers in `src/helper/` instead of copying them; do not add other test-only folders or files that are not `*.test.ts`, and split a test file by `describe` before it grows past a few hundred lines. Mock external model requests while exercising real RPC, SQLite persistence, eviction, and alarms. Tests require no real API keys. No numerical coverage threshold is configured; add regression tests for changed behavior and run `nr check` before submitting.

## Commit & Pull Request Guidelines

There is no commit history yet. Use Conventional Commits, for example `feat(agents): add tool registration`. Keep changes focused. PR descriptions should explain behavior changes, link relevant issues, and report checks performed and any limitations.

## Security & Configuration

Never commit `.dev.vars`, provider credentials, or generated `.cloudflare/` state. Keep credentials in individual Worker secrets such as `OPENAI_API_KEY`, outside agent settings and RPC results. Preserve the private RPC boundary; future UI Workers must authenticate users and authorize access to agent IDs. Only the agents Worker binds D1: the UI Worker never binds a D1 database and reaches the registry and configuration only through `ManagementService`.
