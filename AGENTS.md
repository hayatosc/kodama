# Repository Guidelines

## Project Structure & Module Organization

Kodama runs Pi Durable agents on Cloudflare Durable Objects, with one SQLite-backed object per agent ID. The pnpm workspace currently contains `packages/agents`; `packages/ui` is planned, not implemented.

- `packages/agents/src/index.ts`: service-binding RPC entrypoint.
- `src/agent.ts`, `src/harness.ts`, and `src/events.ts`: durable state, runtime composition, and SSE streaming.
- `src/recovery.ts` and `src/projection.ts`: recovery alarm scheduling and Pi-to-RPC result mapping.
- `src/validation.ts`: valibot schemas for untrusted RPC input; failures throw `TypeError`.
- `src/configuration/`, `src/models/`, `src/prompts/`, and `src/tools/`: configuration, providers, prompts, and registered tools.
- `src/memory/`: long-term memory in D1 through Drizzle; `schema.ts` is the schema, `migrations/` the generated D1 migrations. Write queries with Drizzle's query builder and migrations only with drizzle-kit; do not write SQL by hand. `memory-agent.ts` is the memory agent, `working.ts` what working agents get, `prune.ts` and `archive.ts` the archiving of old Pi entries to R2. `skills.ts` stores skills in R2 and D1, and `skills-env.ts` serves them read-only to Pi's `read` tool.
- `src/storage/`: kodama's tables in each Durable Object's own SQLite (`local-schema.ts`, migrations in `migrations-local/`) and `pi-tables.ts`, Pi Durable's tables as pruning reads them; re-run `test/prune.test.ts` on every Pi upgrade. `src/alarms.ts` is the per-purpose alarm schedule.
- `src/protocol.ts`: transport types; consumers should use type-only imports.
- `packages/agents/test/agent.test.ts`: Workers integration tests.
- `packages/agents/cloudflare.config.ts`: Worker bindings, secrets, and SQLite configuration.

The abbreviated `src/` paths above are relative to `packages/agents/`.

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
- From `packages/agents`, `nr db:generate` writes a D1 migration after `src/memory/schema.ts` changes, and `nr db:generate:local` a local migration after `src/storage/local-schema.ts` changes (add it to `src/storage/local.ts`); tests fail when they differ.

## Coding Style & Naming Conventions

Use strict TypeScript with two-space indentation, single quotes, no semicolons, trailing commas, and a 100-column formatting width. Oxfmt controls formatting; Oxlint enforces type safety. Use type-only imports and handle promises explicitly. Avoid `any`, unsafe assertions, and non-null assertions.

Follow existing camelCase functions, PascalCase types/classes, and lowercase hyphenated filenames such as `current-time.ts`. Write comments and repository documentation in English.

## Testing Guidelines

Use Vitest with the Cloudflare plugin in workerd. Name tests `*.test.ts` under `packages/agents/test/` and describe observable behavior. Mock external model requests while exercising real RPC, SQLite persistence, eviction, and alarms. Tests require no real API keys. No numerical coverage threshold is configured; add regression tests for changed behavior and run `nr check` before submitting.

## Commit & Pull Request Guidelines

There is no commit history yet. Use Conventional Commits, for example `feat(agents): add tool registration`. Keep changes focused. PR descriptions should explain behavior changes, link relevant issues, and report checks performed and any limitations.

## Security & Configuration

Never commit `.dev.vars`, provider credentials, or generated `.cloudflare/` state. Keep credentials in individual Worker secrets such as `OPENAI_API_KEY`, outside agent settings and RPC results. Preserve the private RPC boundary; future UI Workers must authenticate users and authorize access to agent IDs.
