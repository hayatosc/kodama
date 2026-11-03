# Test execution

`nr check` still runs every test, in addition to TypeScript, type-aware lint and formatting.
The Vitest projects use different runtimes rather than different levels of coverage:

- `vitest.node.config.ts` lists portable unit tests and native CLI tests. They do not load
  Worker bindings or apply D1 migrations. The same list excludes these files from workerd,
  so a test file runs in exactly one project. Node files remain sequential because native
  OAuth callback tests use the fixed loopback port 1455.
- `vitest.worker.config.ts` runs the remaining tests with real Workers bindings. File
  isolation, D1 migrations, object SQLite, R2, alarms, eviction and RPC remain enabled.
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

## Targeted runs and measurement

From the workspace root:

```sh
nr --filter @kodama/agents test --project node
nr --filter @kodama/agents test --project workerd
nr --filter @kodama/agents test src/agent/contact.test.ts
nr --filter @kodama/agents test --reporter=json --outputFile=/tmp/kodama-tests.json
```

Use the JSON report's per-file and per-case durations to find expensive fixtures. Compare
full-suite wall time on the same machine and keep the test/pass/skip counts constant.
Record CI measurements separately: local wall time is not a prediction of runner time.
Do not gain speed by disabling isolation, omitting tests, weakening storage coverage or
raising timeouts to hide failures.
