# Test execution

This document covers the tests of `packages/agents`; paths are relative to that package.

`vp run check` still runs every test, in addition to TypeScript, type-aware lint and formatting.
The Vitest projects use different runtimes rather than different levels of coverage:

- `vitest.node.config.ts` lists portable unit tests and native CLI tests. They do not load
  Worker bindings or apply D1 migrations. The same list excludes these files from workerd,
  so a test file runs in exactly one project. Node files remain sequential because native
  OAuth callback tests use the fixed loopback port 1455.
- `vitest.worker.config.ts` runs the remaining tests with real Workers bindings. D1
  migrations, object SQLite, R2, alarms, eviction and RPC remain enabled. Files share one
  runtime per Vitest worker; see Shared workerd runtime.
  Unlisted test files default to this project; review their runtime dependencies before
  adding them to the portable list. `src/lib/*.test.ts` covers the portable helper layer.

## Runtime review

The review covered every test file's imports, cases, timers, fixtures and runtime dependencies.
Tests moved to Node retain their existing assertions and mocks. Production code is unchanged.

| Test concern                                                           | Runtime | Reason                                                                            |
| ---------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------- |
| CLI command/request conversion and stream parsing                      | Node    | Standard JavaScript, Fetch, streams and FormData                                  |
| Native CLI and OAuth callback listener                                 | Node    | Local filesystem, processes or actual loopback HTTP                               |
| Cron and schedule normalization                                        | Node    | The application imports the shared Temporal ponyfill, not workerd-native Temporal |
| Envelope crypto, refresh HTTP, validation and pure helpers             | Node    | Standard Web Crypto, mocked Fetch and pure functions                              |
| Memory evidence construction and skill validation                      | Node    | No storage access; storage imports are type-only                                  |
| Search/provider HTTP fixtures, URL and search-result normalization     | Node    | Standard Fetch with mocked external services                                      |
| Agent, control-plane, credential-vault and memory workflows            | workerd | Real D1, object SQLite, R2 or Durable Object behavior                             |
| Schema/migration comparisons                                           | workerd | Execute the generated migrations against the real storage adapters                |
| Provider registration regression in `src/control-plane/models.test.ts` | workerd | Explicitly checks statically bundled OAuth registration in Workers                |
| HTML extraction and fetch                                              | workerd | Cloudflare HTMLRewriter; do not replace it with a Node DOM implementation         |
| Code execution                                                         | workerd | Real Dynamic Workers, compilation and binding/network isolation                   |
| Mixed pure/storage test files                                          | workerd | Preserve their integration cases rather than weakening them to move the file      |

The Workers filesystem cannot read Vitest's host-side transformed-module cache. Keep
`fsModuleCache: false` for workerd: enabling it fails before collection with a missing
`node_modules/.vitest-cache/...` file. Prebundling dependencies was also tested but did not
improve the measured representative run, so it is not enabled.

MCP transport/OAuth HTTP fixtures and definition/registration parsing also run in Node;
credential persistence, assignment, recovery and invocation remain in workerd.

## MCP recovery fixture

The 101-request OAuth recovery regression deliberately crosses the recovery batch limit of 100. Keep all 101 real D1 requests, completed transactions, credential checks, expiry checks
and two recovery passes. It also asserts all 101 discovery invocations and notice IDs, no
code exchange, and no assignment.

This batch-volume test uses one real discovery result for its shared server and mocks the
completion-notice RPC, instead of repeating catalog writes and launching 101 model runs.
Adjacent single-request recovery tests still use real discovery and durable notices. The
batch test's timeout was reduced from 120 seconds to 30 seconds, not increased.

## Measured full-stack result

The complete review covered 101 test files: 25 now run in Node and 76 in workerd. Twenty
files moved out of workerd; no test cases or assertions were removed. The full local check
retained **1,029 passed / 1 skipped**, with TypeScript, lint and formatting passing.

| Configuration                            | Local full-suite wall time |
| ---------------------------------------- | -------------------------: |
| Before the review                        |                   430.63 s |
| Runtime separation only                  |                   393.84 s |
| Separation plus bounded recovery fixture |                   344.99 s |

This is about a 20% local improvement, not a claimed GitHub-hosted runner result. The Node
project alone ran its 351 tests in 9.41 seconds. Most remaining time belongs to the genuine
Workers integration suite; isolation and storage checks were not disabled to reduce it.

## CI sharding

On a GitHub-hosted runner the whole `vp run check` took about 7 minutes, of which the tests took
386 seconds. The test bodies take about 173 seconds in total; the rest is per-file setup in the
workerd project. With isolation, every test file starts its own Miniflare runtime, and the main
Vitest process serializes and sends the file's whole module graph to it (`transform` is about
70% of the reported duration). A CPU profile of the main process showed about 5 seconds of
serialization per workerd file, and the workerd processes compile those modules again per file.

That cost is bound by the runner's CPU, not by Vitest's worker count. Locally (4 cores), the
full suite took 497 s in one process and 341 s as two concurrent `--shard` processes on the same
machine. CI therefore runs the tests as four `--shard` jobs on separate runners, beside one job
for TypeScript, lint, formatting and the build. The `Check and build` job passes only when all of
them pass, so it remains the single status to require. The test list and timeouts are unchanged.
Locally, `vp run check` still runs everything in one process.

## Shared workerd runtime

The workerd project sets `isolate: false`, so each Vitest worker keeps one Miniflare runtime and
module graph across files instead of rebuilding them per file. Locally this took the workerd
project from 497 s to about 100 s.

Before every file, `vitest.setup.ts` removes what the previous file left that this one can see:

- every row of both D1 schemas, first, so an alarm a previous file's working agent left behind
  finds no registry row or credential and makes no model call against this file's mocked fetch;
- every object in the archive bucket;
- the memory agent's storage, alarm and instance: it is the one object every file addresses by
  the same name, and its job drain lives in memory. Working agents need nothing, because tests
  address them by fresh UUIDs;
- the cached seed in `src/testing/management.ts`.

After each file it restores mocks, global stubs and real timers.

`reset()` from `cloudflare:test` is not used, because it leaves SQLite-backed object storage and
D1 intact. `abortAllDurableObjects()` is not used either: alarms of objects created after it
stopped firing.

Module-level code runs once per Vitest worker, not once per file. A helper must not register
hooks when it is imported (`beforeAll(seedOnce)` at the top of `src/testing/memory.ts` seeded
only the first file that imported it); call such hooks from each test file instead. Keep
module-level state in tests and helpers resettable from `vitest.setup.ts`, as `forgetSeed()` is.

A test whose agent keeps working after it ends (a turn retried in the background, for example)
can reach the next test's fetch mock, which shows up more often with the faster shared runtime.
Stop such agents in `afterEach` with `stopAgentObject` from `src/testing/rpc.ts`, as
`src/mcp/registration/chat.test.ts` does. A test that passes alone but fails in the full run
usually depends on state another test or file left behind.

## Test scripts and Vite+

The `test` and `test:coverage` scripts call `vitest` directly rather than `vp test`. `vp run`
executes a script's `vp` with the CLI that started it, and the `vp` that mise installs carries
its own copy of Vitest. Test files import `vite-plus/test`, which re-exports the workspace's
Vitest, so `vp test` from the mise CLI loaded two Vitest instances, and every workerd file failed
with "Vitest failed to find the current suite". The workspace `vitest` is the same version that
`vite-plus` bundles (pinned in the pnpm catalog).

## Targeted runs and measurement

From the workspace root:

```sh
vp run --filter @kodama/agents test --project node
vp run --filter @kodama/agents test --project workerd
vp run --filter @kodama/agents test src/agent/contact.test.ts
vp run --filter @kodama/agents test --reporter=json --outputFile=/tmp/kodama-tests.json
```

Use the JSON report's per-file and per-case durations to find expensive fixtures. Compare
full-suite wall time on the same machine and keep the test/pass/skip counts constant.
Record CI measurements separately: local wall time is not a prediction of runner time.
Do not gain speed by sharing state between files, omitting tests, weakening storage coverage or
raising timeouts to hide failures.
