# Repository Guidelines

## Project Structure & Module Organization

Kodama runs Pi Durable agents on Cloudflare Durable Objects, with one SQLite-backed object per agent ID. The pnpm workspace currently contains `packages/agents`; `packages/ui` is planned, not implemented.

- `packages/agents/src/index.ts`: service-binding RPC entrypoint.
- `packages/agents/drizzle/`: every Drizzle schema, next to the migrations drizzle-kit generates from it, one folder per database. `d1/schema.ts` is the D1 schema and `d1/migrations/` its migrations (apply them with `cf d1 migrations apply --dir drizzle/d1/migrations`). `durable-object/schema.ts` is kodama's tables in each Durable Object's own SQLite, and `durable-object/migrations/` their migrations, which `src/storage/local.ts` applies. Keep one schema file per SQLite database. Edit the schemas by hand; never edit the `migrations/` folders.
- `src/lib/`: generic helpers that import nothing else from `src/` (`hash.ts`, `search-text.ts`, `redact.ts`).
- `src/agent/`: the `Agent` Durable Object and its runtime (`harness.ts`, `events.ts`, `alarms.ts`, `recovery.ts`, `projection.ts`). `agent.ts` only wires the parts and serves RPC; put behavior in its own module there (`session.ts` the harness and its exclusive section, `maintenance.ts` pruning control, `entries.ts` entry pages, `memory.ts` working-agent memory, `config.ts` configuration, `views.ts` snapshot and submission reads) or under `src/memory/`, not in `agent.ts`.
- `src/validation.ts`: valibot schemas for untrusted RPC input; failures throw `TypeError`.
- `src/configuration/`, `src/models/`, `src/prompts/`, and `src/tools/`: configuration, providers, prompts, and registered tools.
- `src/memory/`: long-term memory, one folder per part. Keep each file to one concern; split a file before it grows past a few hundred lines.
  - `store/`: D1 through Drizzle, with the schema in `drizzle/d1/schema.ts`. `records.ts` applies write operations, `record-plans.ts` and `progress-plans.ts` plan them, `statements.ts` holds the statements they share, `search.ts` searches records. Write queries with Drizzle's query builder and migrations only with drizzle-kit; do not write SQL by hand.
  - `memory-agent/`: the memory agent (`memory-agent.ts` runs the queue), its queue (`queue.ts`), harness, model jobs, prompts, daily consolidation, and its tools in `tools/`.
  - `working/`: what working agents get: the always-loaded memory, the memory tools, and the extension.
  - `archive/`: archived segments in R2 (`segment.ts` writes, `reader.ts` reads) and `history_search`.
  - `prune/`: pruning of old Pi entries: limits, runs, the steps before the delete, and the delete.
  - `skills/`: skills in R2 and D1 (paths, blobs, writes, status changes, usage, curation); `env.ts` serves them read-only to Pi's `read` tool.
  - `shared/`: proposals to shared spaces and their application.
- `src/storage/`: opening kodama's tables in each Durable Object's own SQLite (`local.ts`; the schema is `drizzle/durable-object/schema.ts`) and `pi-tables.ts`, Pi Durable's tables as pruning reads them; re-run `src/memory/prune/prune.test.ts` and `src/storage/pi-assumptions.test.ts` on every Pi upgrade.
- `src/protocol.ts`: transport types; consumers should use type-only imports.
- Tests sit next to the code they test, as `<module>.test.ts` in the same folder (for example `src/agent/agent.test.ts` for the Agent RPC and `src/memory/prune/prune.test.ts` for pruning); `drizzle/schema.test.ts` checks the schemas against their migrations. Shared helpers and the Vitest setup are in `src/testing/`; production code never imports them.
- `packages/agents/cloudflare.config.ts`: Worker bindings, secrets, and SQLite configuration.

The abbreviated `src/` paths above are relative to `packages/agents/`.

Imports follow the layers in `docs/agents.md` (Dependencies): `lib` imports nothing else from `src/`, the memory parts never import `src/agent/` or `memory-agent/` (they use `src/memory/jobs.ts`), and only `memory-agent/` sits above `src/agent/`. `src/layers.test.ts` fails on an import that breaks the rule; put new code in the lowest layer it fits.

`docs/agents.md` explains the runtime and `docs/memory.md` long-term memory. File comments cite
their sections by name, so keep the headings and the code in step when either changes.

## Build, Test, and Development Commands

Use Node.js >=22.19 and the pinned pnpm 12.14.0 through `ni`/`nr` wrappers.

- `ni`: install workspace dependencies.
- Copy `packages/agents/.dev.vars.example` to `packages/agents/.dev.vars` and populate provider credentials.
- `nr dev:agents`: start the local Worker; it exposes RPC, not a browser page.
- `nr agent send assistant "Hello"`: send through the development adapter to Durable Object RPC; see `nr agent --help` for history and cancellation.
- `nr check`: run TypeScript, type-aware Oxlint, Oxfmt checks, and tests.
- `nr test`: run workspace tests.
- `nr format`: format the repository; review resulting changes.
- From `packages/agents`, `nr build` builds without deploying, and `nr cf:types` regenerates runtime types.
- From `packages/agents`, `nr db:generate` writes a D1 migration after `drizzle/d1/schema.ts` changes, and `nr db:generate:local` a local migration after `drizzle/durable-object/schema.ts` changes (add it to `src/storage/local.ts`); tests fail when they differ.

## Coding Style & Naming Conventions

Use strict TypeScript with two-space indentation, single quotes, no semicolons, trailing commas, and a 100-column formatting width. Oxfmt controls formatting; Oxlint enforces type safety. Use type-only imports and handle promises explicitly. Avoid `any`, unsafe assertions, and non-null assertions.

Follow existing camelCase functions, PascalCase types/classes, and lowercase hyphenated filenames such as `current-time.ts`. Write comments and repository documentation in English.

## Testing Guidelines

Use Vitest with the Cloudflare plugin in workerd. Put each test next to the module it tests as `<module>.test.ts` (not in a separate `test/` folder) and describe observable behavior. Put shared mocks and helpers in `src/testing/` instead of copying them, and split a test file by `describe` before it grows past a few hundred lines. Mock external model requests while exercising real RPC, SQLite persistence, eviction, and alarms. Tests require no real API keys. No numerical coverage threshold is configured; add regression tests for changed behavior and run `nr check` before submitting.

## Commit & Pull Request Guidelines

There is no commit history yet. Use Conventional Commits, for example `feat(agents): add tool registration`. Keep changes focused. PR descriptions should explain behavior changes, link relevant issues, and report checks performed and any limitations.

## Security & Configuration

Never commit `.dev.vars`, provider credentials, or generated `.cloudflare/` state. Keep credentials in individual Worker secrets such as `OPENAI_API_KEY`, outside agent settings and RPC results. Preserve the private RPC boundary; future UI Workers must authenticate users and authorize access to agent IDs.
