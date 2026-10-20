# Long-term memory

Status: proposal. Nothing in this document is implemented yet.
A Japanese version is in [long-term-memory.ja.md](long-term-memory.ja.md).
The reasons for each decision are in [long-term-memory-rationale.md](long-term-memory-rationale.md).

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

| Table                    | Rows                                                          |
| ------------------------ | ------------------------------------------------------------- |
| `memory_records`         | one memory record                                             |
| `memory_fts`             | FTS5 index over `memory_records.search_text` (triggers)       |
| `extraction_checkpoints` | last extracted entry per agent                                |
| `skills`                 | skill index: name, description, status, version, R2 directory |
| `skill_usage`            | skill uses per agent                                          |
| `shared_proposals`       | proposals for shared memory and their decisions               |
| `memory_ledger`          | append-only log of every change, including declined items     |

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
  `read_entries`, `skill_write`, `skill_archive`, `shared_propose`, and `notify_memory_changed`.
  `skill_write` accepts only agent scopes. The working agents' registry does not contain them.
- Jobs are JSON messages validated with valibot: `remember`, `extract`, `record_archive`,
  `consolidate`, `apply_proposal`. They arrive through `sendMessage` on `MEMORY_AGENT`; Pi queues
  them and runs one at a time.
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

Skills follow the Agent Skills format: a directory with `SKILL.md` (`name`, `description`) and
optional `references/`, `assets/`, and `scripts/`.

### Scopes and visibility

| Scope             | Visible to                                    | Changed by                                      |
| ----------------- | --------------------------------------------- | ----------------------------------------------- |
| `agent:<agentId>` | that agent                                    | memory agent                                    |
| `shared:<space>`  | agents whose `sharedSpaces` include `<space>` | memory agent, only through an accepted proposal |

- `sharedSpaces` is a new `AgentConfig` field (default `["global"]`), validated like `tools`.
  Shared memory records use the same field.
- An agent skill shadows a shared skill with the same name. Between shared spaces, the earlier
  space in `sharedSpaces` wins. Each name appears once in the listing.

### Storage and versions

- Each version is its own R2 directory, `skills/<scope>/<name>/v<version>/`. A new version never
  overwrites files that a read may be using.
- The `skills` row points to the current version (`version`, `r2_key`).
- `skill_usage` counts uses per skill and agent. Working agents upsert it.

### Listing and loading

- A `skills` extension adds a `skills` section with the visible active skills as name,
  description, and path `/skills/<scope>/<name>/SKILL.md`: agent skills first, then shared
  skills by this agent's uses, then by all agents' uses, at most 50. The list is refreshed with
  the always-loaded memory.
- The model loads a skill with the `read` tool from `@earendil-works/pi-durable/tools`. The
  conversation's `env` is `SkillsEnv`, a read-only `ExecutionEnv` that resolves
  `/skills/<scope>/<name>/...` to the current version's R2 directory. Paths of skills the agent
  cannot see return not found. Writes, `exec`, and `watch` return `not_supported`. Relative paths
  resolve against the skill directory. Scripts can be read but not run.
- An `afterTool` hook on `read` upserts `skill_usage` when the path ends in `SKILL.md`.

### Lifecycle

All changes are made by the memory agent during `consolidate` and logged in `memory_ledger`.

- **Create.** An agent skill, from a procedure that succeeded at least twice in that agent's
  trajectories, with the trajectories and failure lessons as evidence. It is written as
  `proposed`, and becomes `active` after a replay or check passes.
- **Update an agent skill.** A new version from new evidence of the same agent, after a check.
- **Promote.** When agent skills of two or more agents describe the same procedure, or an
  operator asks, the memory agent merges them into one `shared_proposals` row (target `skill`)
  that lists the sources. When it is accepted, the memory agent writes `shared:<space>/<name>`
  version 1, archives the source agent skills with `absorbed_into`, and moves their
  `skill_usage` rows to the shared skill.
- **Update a shared skill.** Only through a proposal with evidence from the agents that use it,
  accepted by review. It becomes a new version.
- **Override.** When a shared skill keeps failing for one agent while a different procedure
  succeeds, the memory agent writes an agent skill with the same name and `based_on` set to the
  shared version. It shadows the shared skill for that agent only. When several agents override
  a shared skill the same way, that becomes an update proposal for the shared skill.
- **Curate.** An agent skill becomes `stale` after 14 days without use by its agent and
  `archived` after 30. A shared skill becomes `stale` after 30 days without use by any agent and
  `archived` after 60. Pinned skills are exempt. Archived skills can be restored.

### Review

`AgentService` gains `listProposals(space)` and `decideProposal(id, decision, reason)` for the
UI server, which authenticates the reviewer. `decideProposal` records the decision in
`shared_proposals` and sends an `apply_proposal` job to the memory agent, which performs the
write.

## Shared memory

- The memory agent creates a `shared_proposals` row from agent-scope records that more than one
  agent relies on. A reviewer decides it through `decideProposal` (see Skills, Review).
- Agents read the shared spaces listed in their `sharedSpaces`.
- Accepted proposals become new record versions; shared records are never rewritten in place.
- Content from untrusted sources is stored as an `event` with its source and is never pinned or
  promoted to the always-loaded memory without review.
- Secrets are redacted before any write.

## Configuration

| Setting                          | Default                                  |
| -------------------------------- | ---------------------------------------- |
| `progress.partialIntervalMs`     | 100 ms (to be raised after measurement)  |
| `MEMORY_MODEL_PROVIDER` / `_ID`  | none                                     |
| idle delay before `extract`      | to be set                                |
| always-loaded budget             | 2,200 characters (agent), 1,000 (shared) |
| pruning threshold                | 1 GB                                     |
| submission retention             | 30 days                                  |
| event half-life                  | 30 days                                  |
| agent skill stale / archive      | 14 / 30 days                             |
| shared skill stale / archive     | 30 / 60 days                             |
| skills listed per agent          | 50                                       |
| agents needed to promote a skill | 2                                        |
| `sharedSpaces`                   | `["global"]`                             |

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
4. **Skills.** `skills` extension, `SkillsEnv`, `skill_usage` hook, agent-skill lifecycle,
   curation.
   Tests: the section lists visible active skills with paths, agent skills first; an agent skill
   shadows a shared skill of the same name; `read` returns `SKILL.md` and a bundled file by
   relative path; a path of a skill the agent cannot see returns not found; writes and `exec`
   through `SkillsEnv` fail; a new version does not change files of the previous one; reading
   `SKILL.md` upserts `skill_usage`; `SkillsEnv` passes the read part of
   `registerEnvConformance()`.
5. **Shared memory and shared skills.** `sharedSpaces`, shared records, promotion and override of
   skills, `listProposals`, `decideProposal`, `apply_proposal`.
   Tests: an agent sees only the shared spaces in its `sharedSpaces`; two agents with the same
   procedure produce one promotion proposal; accepting it creates the shared skill, archives the
   sources with `absorbed_into`, and moves their usage; a rejected proposal changes nothing; a
   shared skill changes only through an accepted proposal.
6. **Evaluation.** Probe questions after compaction and pruning: recall, files touched,
   continuation, decisions, knowledge updates, temporal questions, abstention.

## Open questions

- How long must archived entries be kept, and who may delete them?
- Which model should the memory agent use?
- How coarse may live streaming to the UI become in exchange for fewer writes?
