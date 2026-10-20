# Long-term memory

Status: proposal. Nothing in this document is implemented yet.
A Japanese version is in [long-term-memory.ja.md](long-term-memory.ja.md).

Kodama agents run for weeks or months in one conversation. This design keeps what matters in
long-term memory outside the agent's Durable Object, keeps the Pi session in the object, and
prunes the session's old rows so storage stays bounded.

## Components

| Store                        | Binding        | Contents                                                                   |
| ---------------------------- | -------------- | -------------------------------------------------------------------------- |
| Agent Durable Object         | `AGENTS`       | Pi Durable session; frozen copy of the always-loaded memory and skill list |
| `MemoryAgent` Durable Object | `MEMORY_AGENT` | the memory agent (one instance, `memory`)                                  |
| D1 database                  | `MEMORY_DB`    | memory records, FTS5 index, checkpoints, skill index, proposals, ledger    |
| R2 bucket                    | `ARCHIVE`      | pruned entries (`archive/`) and skill directories (`skills/`)              |

```text
AgentService (public RPC entrypoint)
  `-- AGENTS ---------------------> Agent DO (agentId)   MemoryAgent is not reachable from here

Agent DO (agentId)
  |-- reads ----------------------> D1 MEMORY_DB         memory_search, history_search, lists
  |-- read (SkillsEnv) -----------> R2 ARCHIVE           SKILL.md and bundled files
  |-- MEMORY_AGENT.sendMessage ---> MemoryAgent DO       remember, extract, record_archive
  `-- writes ---------------------> R2 ARCHIVE           entries about to be pruned

MemoryAgent DO ("memory")
  |-- reads and writes -----------> D1 MEMORY_DB
  |-- reads and writes -----------> R2 ARCHIVE           archived entries, skill directories
  |-- AGENTS readEntries ---------> Agent DO             paged entries for extraction
  `-- AGENTS memoryChanged -------> Agent DO             refresh at the next idle

scheduled handler --------------> MemoryAgent DO       consolidate (daily)
```

Only the memory agent writes long-term memory. Working agents write usage counters only.

## Memory model

### Scopes

| Scope                                          | Contents                                       | Writer                     |
| ---------------------------------------------- | ---------------------------------------------- | -------------------------- |
| `agent:<agentId>`                              | the agent's notes, conventions, events, skills | memory agent               |
| `shared:<space>` (for example `shared:global`) | team conventions, shared facts, shared skills  | memory agent, after review |

There is no per-person scope.

### Kinds

| Kind          | Topic key | Lifetime                                                                   |
| ------------- | --------- | -------------------------------------------------------------------------- |
| `fact`        | required  | no decay; a new fact with the same key supersedes the old one              |
| `instruction` | required  | as `fact`; multi-step instructions become skill candidates                 |
| `event`       | none      | ranked by recency (half-life 30 days); archived after the retention window |
| `task`        | none      | dropped when done                                                          |

`origin` is one of `user_request`, `agent_judgment`, `extraction`, `consolidation`, or
`archive` (the summary of an archived range of entries). Hard deletion is an operator action.

### D1 schema

The schema is [long-term-memory.sql](long-term-memory.sql), applied as a D1 migration with
`cf d1 migrations`.

| Table                    | Rows                                                       |
| ------------------------ | ---------------------------------------------------------- |
| `memory_records`         | one memory record                                          |
| `memory_fts`             | FTS5 index over `memory_records.search_text` (triggers)    |
| `extraction_checkpoints` | last extracted entry per agent                             |
| `skills`                 | skill index: name, description, status, R2 directory, uses |
| `shared_proposals`       | proposals for shared memory and their decisions            |
| `memory_ledger`          | append-only log of every change, including declined items  |

Rules:

- Record ID: SHA-256 of scope, kind, topic key, content, source agent, and first source entry.
  Writes use `INSERT OR IGNORE`.
- Superseding: mark the old record `superseded` and insert the new one in one `batch()`. The
  partial unique index on active `(scope, kind, topic_key)` makes a concurrent supersede fail
  and roll back; reread and retry.
- `superseded_by` is not a foreign key, because D1 checks foreign keys immediately and the old
  row is updated before the new row exists.
- Entry IDs are never reused, so checkpoints and archive ranges are keyed by agent and entry ID
  only.

### Search text

`search_text` holds normalized words joined by spaces, and FTS5 indexes it with
`unicode61 remove_diacritics 2`. One shared function produces it for records and queries:

1. NFKC-normalize and lowercase.
2. Segment with `new Intl.Segmenter('ja', { granularity: 'word' })`; keep `isWordLike`
   segments.
3. In each segment, remove `ー` after katakana (`/([ァ-ヴ])ー+/g` → `$1`).
4. Merge adjacent katakana segments into one word.
5. For records only: append the original segments that differ from the merged words.

A query quotes each merged word and joins them with spaces (FTS5 `AND`). If nothing matches,
retry with each word as a prefix (`"word"*`). `search_version` stores the version of this
function; consolidation re-segments rows with an older version.

### Queries

- Always-loaded memory: active `instruction` and `fact` records of the agent's scope and the
  shared scope, ordered by `pinned`, `importance`, `last_used_at`, cut to a character budget in
  code.
- `memory_search`: `memory_fts MATCH ?` joined to active records in the allowed scopes, ordered
  by `bm25()`, then reranked by recency and importance. Increment `use_count` and set
  `last_used_at` on the returned rows in one statement.
- `history_search`: `memory_search` over `archive` records, then read the archived range from
  R2.

## Memory agent

- `class MemoryAgent extends Agent`, exported as its own Durable Object class, one instance
  named `memory`.
- Not part of `AgentService`. Jobs come only from working agents' tools, pruning, and the
  `scheduled` handler.
- Fixed configuration built in code: model from `MEMORY_MODEL_PROVIDER` and `MEMORY_MODEL_ID`,
  the memory-keeping system prompt. `setConfig` throws.
- Its own registry holds the tools `memory_write`, `memory_supersede`, `memory_decline`,
  `read_entries`, `skill_propose`, `shared_propose`, and `notify_memory_changed`. The working
  agents' registry does not contain them.
- Jobs are JSON messages validated with valibot: `remember`, `extract`, `record_archive`,
  `consolidate`. They arrive through `sendMessage` on `MEMORY_AGENT`; Pi queues them and runs one
  at a time.
- A job's `requestId` is a hash of the source agent, the source entry, and the content, so a
  repeated delivery returns the existing submission.
- After each job settles, the memory agent calls `reset()` on its root conversation. Its own
  storage is pruned like any agent's, without extraction.

## Working agents

Tools: `memory_search`, `history_search`, `remember`, and Pi Durable's `read` tool for skills.

`remember` is called in the turn when:

- the user asks to remember something or gives a standing instruction ("always", "from now on");
- the agent judges something worth keeping: a decision and its reason, a correction from the
  user, a lesson from a failure, or a durable fact it had to look up.

The system prompt lists what not to keep: task state, tentative conclusions, secrets, one-off
requests, and anything the repository or its docs already cover. At most three `remember` calls
are accepted per turn.

## Write paths

### Remember

1. Validate the input with valibot, cap its size, and reject injection patterns.
2. Send a `remember` job with `sendMessage`, carrying the content, its origin
   (`user_request` or `agent_judgment`), and the source entry IDs. Return once it is admitted.
3. The memory agent classifies it, reconciles it with existing records, and writes it:
   - `user_request`: written as asked; it supersedes an earlier record with the same key.
   - `agent_judgment`: may be declined as a duplicate or low value (logged in the ledger);
     starts with lower importance; archived by consolidation if never used.
4. The memory agent calls `memoryChanged` on the working agent.

### Extract

Sent by the working agent when it has been idle for a while (its alarm) and before pruning.

1. `read_entries` pages through entries after the checkpoint (`scanEntries` in the agent DO).
2. Extract candidate records.
3. Drop candidates that the cited entries do not support.
4. Add, supersede, invalidate, or skip against existing records.
5. Advance the checkpoint in the same `batch()` as the writes.

### Consolidate

Sent once a day by the `scheduled` handler. Merge duplicates, resolve contradictions, decay
events, adjust importance and pinning so the always-loaded memory fits its budget, re-segment
rows with an old `search_version`, propose skills, prepare shared proposals, and delete
archived events and old ledger rows in small batches.

## Always-loaded memory

A Pi prompt section renders two capped blocks from the always-loaded query: the agent's memory
and a small shared block, each with its budget shown (`[67% — 1,474/2,200 chars]`). The agent
DO stores the rendered text in a Pi document and refreshes it when the object starts and when
`memoryChanged` arrives while it is idle. Requests read the stored copy.

## Compaction

Pi's built-in compaction with its defaults. Kodama does not hook or replace it.

## Pruning

The agent DO archives and deletes old rows of its Pi session.

Prunable rows, where `P` is the `head` of the newest head marker in the root conversation:

- `entries` of the root conversation with `id < P`;
- `tasks` with `status = 'terminal'`, with their task-scoped `documents` and
  `document_revisions`;
- `submissions` with status `done` or `unanswered` older than 30 days;
- the matching `record_ids` rows.

Run only when the agent is idle, the root is the only conversation, and
`ctx.storage.sql.databaseSize` is above the threshold (1 GB by default) or the prunable entries
exceed a count.

Steps:

1. If the checkpoint is below `P - 1`, send an `extract` job up to `P - 1` and wait for it.
2. Write the entries from the last pruned ID to `P - 1` to
   `archive/<agentId>/<first>-<last>.jsonl`, then its manifest (range, count, SHA-256, the head
   marker's summary), and verify both.
3. Send a `record_archive` job; the memory agent stores the summary as an `archive` record.
4. In `blockConcurrencyWhile`: close the harness, delete the prunable rows in one
   `transactionSync`, store `P` as the pruned boundary, reopen the harness, and refresh the
   recovery alarm.

Pruning writes to Pi's internal tables. Pin the Pi Durable version, keep pruning in one module,
and run the pruning tests on every Pi upgrade.

## Skills

- Agent Skills directories (`SKILL.md` with `name` and `description`, optional `references/`,
  `assets/`, `scripts/`) in R2 under `skills/<scope>/<name>/`; index rows in D1 `skills`.
- A `skills` extension adds a `skills` section listing active skills of the agent's scope and the
  shared scope as name, description, and path `/skills/<scope>/<name>/SKILL.md`. The list is
  refreshed with the always-loaded memory.
- The model loads a skill with the `read` tool from `@earendil-works/pi-durable/tools`. The
  conversation's `env` is `SkillsEnv`, a read-only `ExecutionEnv` that maps `/skills/...` to R2:
  read methods work; writes, `exec`, and `watch` return `not_supported`. Relative paths resolve
  against the skill directory. Scripts can be read but not run.
- An `afterTool` hook on `read` increments the skill's `use_count` when the path ends in
  `SKILL.md`.
- The memory agent proposes a skill during consolidation only from a procedure that succeeded at
  least twice, citing the trajectories and the failure lessons. It becomes active after a replay
  or check passes; shared skills also need review.
- Curation: `stale` after 14 days unused, `archived` after 30; pinned skills are exempt; archived
  skills can be restored.

## Shared memory

- The memory agent creates a `shared_proposals` row from agent-scope records that more than one
  agent relies on. A reviewer accepts or rejects it through an operator RPC.
- Accepted proposals become new record versions; shared records are never rewritten in place.
- Content from untrusted sources is stored as an `event` with its source and is never pinned or
  promoted to the always-loaded memory without review.
- Secrets are redacted before any write.

## Configuration

| Setting                         | Default                                  |
| ------------------------------- | ---------------------------------------- |
| `progress.partialIntervalMs`    | 100 ms (to be raised after measurement)  |
| `MEMORY_MODEL_PROVIDER` / `_ID` | none                                     |
| idle delay before `extract`     | to be set                                |
| always-loaded budget            | 2,200 characters (agent), 1,000 (shared) |
| pruning threshold               | 1 GB                                     |
| submission retention            | 30 days                                  |
| event half-life                 | 30 days                                  |
| skill stale / archive           | 14 / 30 days                             |

## Phases

Each phase ships with workerd integration tests that mock the model.

1. **Measurement.** Set the progress interval explicitly; record rows written, database size,
   and context size per turn.
   Tests: rows per turn stay under a recorded budget.
2. **D1 memory and the memory agent.** Migration, search-text function, `MemoryAgent`,
   `remember`, `extract` with checkpoint, `memory_search`, always-loaded section.
   Tests: `remember` sends a job in the same turn and the record is in D1 before the agent goes
   idle; a repeated tool call creates no second submission; an agent-judged duplicate is
   declined; working agents have no memory-writing tools and `AgentService` cannot reach the
   memory agent; a fact stated before several compactions is found afterwards; a newer fact
   supersedes an older one; a resumed extraction writes no duplicates; a failed extraction keeps
   the checkpoint and does not affect the conversation; Japanese queries such as 「使う」,
   「リポ」, 「サーバレス」 find their records.
3. **Pruning.** R2 export and manifests, the pruning module, `record_archive`,
   `history_search`.
   Tests: after pruning the conversation continues, compacts again, survives eviction and alarm
   recovery, and cancels; `snapshot()` is unchanged; request IDs inside the retention window stay
   deduplicated; rows are deleted only after a verified export; `databaseSize` falls.
4. **Skills.** `skills` extension, `SkillsEnv`, usage hook, proposals, curation.
   Tests: the section lists active skills with paths; `read` returns `SKILL.md` and a bundled
   file by relative path; writes and `exec` through `SkillsEnv` fail; reading `SKILL.md`
   increments `use_count`; `SkillsEnv` passes the read part of `registerEnvConformance()`.
5. **Shared memory.** Shared scopes, proposals, review RPC.
6. **Evaluation.** Probe questions after compaction and pruning: recall, files touched,
   continuation, decisions, knowledge updates, temporal questions, abstention.

## Open questions

- Who reviews shared-memory proposals: a person through the UI, or the memory agent?
- How long must archived entries be kept, and who may delete them?
- Which model should the memory agent use?
- How coarse may live streaming to the UI become in exchange for fewer writes?
