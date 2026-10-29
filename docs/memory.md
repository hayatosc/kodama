# Long-term memory

Kodama agents run for weeks or months in one conversation. Pi Durable compacts the context but never
removes anything from storage. Long-term memory does three things:

- it keeps what matters outside the agent's Durable Object, where agents can share it;
- it gives each agent a small always-loaded memory, plus tools to search the rest;
- it archives old Pi entries to R2 and prunes them from the object, so storage stays bounded.

The runtime it builds on is described in [agents.md](agents.md). Code lives under
[`packages/agents/src/memory/`](../packages/agents/src/memory/), and file comments cite the
sections of this document by name.

## Components

| Store                       | Binding     | Contents                                                                             |
| --------------------------- | ----------- | ------------------------------------------------------------------------------------ |
| Agent Durable Object        | `AGENTS`    | Pi Durable session; always-loaded copy and skill list; pruning state; alarm schedule |
| Memory agent Durable Object | `AGENTS`    | the memory agent: a `MemoryAgent` object named `kodama:memory`, with its job queue   |
| D1 database                 | `MEMORY_DB` | memory records, applied operations, revisions, archive catalog, skills, ledger       |
| R2 bucket                   | `ARCHIVE`   | archived entries and their search indexes (`archive/`)                               |

```text
AgentService (public RPC entrypoint)
  `-- AGENTS ---------------------> Agent DO (agentId)   rejects the memory agent's name

Agent DO (agentId)
  |-- reads ----------------------> D1 MEMORY_DB         memory_search, always-loaded query, revisions
  |-- writes ---------------------> D1 MEMORY_DB         usage counters, archive catalog (pruning)
  |-- reads and writes -----------> R2 ARCHIVE           archived entries and indexes, history_search
  `-- AGENTS enqueue -------------> memory agent         remember, extract

MemoryAgent DO "kodama:memory" (the memory agent)
  |-- reads and writes -----------> D1 MEMORY_DB
  |-- reads ----------------------> R2 ARCHIVE           archived entries, for a lagging extraction
  |-- AGENTS readEntries ---------> Agent DO             paged entries for extraction
  `-- AGENTS memoryChanged -------> Agent DO             refresh hint; revisions are the record

scheduled handler (17 3 * * *) -> memory agent         consolidate
```

Only the memory agent changes memory records and skills. Working agents write only usage counters
and, while pruning, the archive catalog of their own entries.

### Code layout

| Path               | Contents                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------- |
| `store/`           | D1 queries and writes: records, search, archive catalog, skills, maintenance, job results |
| `job-*.ts`         | job context, entry reads, evidence, permissions, and operation workflows                  |
| `consolidation.ts` | daily consolidation: retention, curation, and the consolidate jobs it queues              |
| `working/`         | always-loaded prompt assembly and refresh, remember-request workflow                      |
| `archive/`         | archived segments in R2: building, reading, and `history_search`                          |
| `prune/`           | the pruning state machine and its limits                                                  |
| `skills.ts`        | pure skill types, naming rules, limits, and validation                                    |
| `shared.ts`        | checked writes to shared spaces                                                           |
| `jobs.ts`          | the memory agent's input contract: job kinds, their validation, and the object's name     |
| `transcript.ts`    | the text of Pi entries that extraction and archives read, and paged entry reads           |

Paths in the table are relative to `src/memory/`. Model-facing schemas, descriptions, and result
formatting are separated by audience: `src/tools/working-agent/memory.ts` serves working agents,
while `src/tools/memory-agent/` contains only the memory agent's dedicated adapters and helpers.
Neither tool set imports the other's adapters; shared behavior lives in memory workflows or stores. Tools call workflows or store functions without constructing queries.
`src/agent/memory-extension.ts` wires the working-agent tools and Pi hooks. Object SQLite
queries live in `src/storage/memory.ts`, `src/storage/memory-jobs.ts`, and
`src/storage/pruning.ts`, separately from memory workflows. D1 queries live only in `store/`.
R2 encoding and IO remain in `archive/`.

The memory agent itself, the `MemoryAgent` class, is in `src/system-agents/memory/` (see [Memory agent](#memory-agent)). It is an internal agent that manages memory; `src/memory/` holds the memory capabilities it and working agents use.

The schemas live next to their migrations under
[`packages/agents/drizzle/`](../packages/agents/drizzle/), one folder per database (see
[D1 schema](#d1-schema)). Kodama's own tables in each Durable Object's SQLite are in
[`drizzle/durable-object/schema.ts`](../packages/agents/drizzle/durable-object/schema.ts): the
memory agent's job queue, the per-turn `remember` count, the always-loaded copy, and pruning runs.
The search-text function is a generic helper in [`src/lib/`](../packages/agents/src/lib/). How the folders may depend on each other is described
in [agents.md](agents.md#dependencies).

## Memory model

### Scopes

| Scope                                          | Contents                                   | Writer                               |
| ---------------------------------------------- | ------------------------------------------ | ------------------------------------ |
| `agent:<agentId>`                              | the agent's notes, conventions, and events | memory agent                         |
| `shared:<space>` (for example `shared:global`) | team conventions and shared facts          | memory agent, through checked writes |

There is no per-person scope. An agent's `sharedSpaces` configuration (default `["global"]`) lists
the shared spaces it reads; see [Shared memory](#shared-memory).

An agent record may set `overrides` to the ID of a shared record. For that agent, the agent record
replaces the shared one, unless the shared record is `required` (a team rule): then the agent
record is not loaded, and consolidation marks it `invalid` with a ledger row. Other agents keep the
shared record.

### Kinds

| Kind          | Lifetime                                                           |
| ------------- | ------------------------------------------------------------------ |
| `fact`        | no decay; replaced only by a newer record that supersedes it by ID |
| `instruction` | as `fact`; multi-step instructions become skill candidates         |
| `event`       | ranked by recency, with a half-life of 30 days                     |
| `task`        | dropped when done                                                  |

A record's status is `active`, `superseded`, `invalid`, or `archived`. Its `origin` is
`remember`, `extraction`, `consolidation`, or `shared`. The code that builds a record from a job
sets the scope, origin, source agent, and cited entries, so the model never chooses them. Hard
deletion is an operator action.

### D1 schema

The schema is defined with Drizzle in
[`drizzle/memory/schema.ts`](../packages/agents/drizzle/memory/schema.ts): one schema file for the one
database.

| Table                    | Rows                                                                              |
| ------------------------ | --------------------------------------------------------------------------------- |
| `memory_records`         | one memory record                                                                 |
| `memory_terms`           | one normalized word of one record: the search index                               |
| `memory_ops`             | one applied write operation and its result                                        |
| `revision_claims`        | the revision one change moved a record, checkpoint, or skill to                   |
| `scope_revisions`        | a new random value with each change to a scope's always-loaded records and skills |
| `extraction_checkpoints` | last extracted entry per agent                                                    |
| `archive_segments`       | catalog entry of one archived range in R2                                         |
| `skills`                 | one skill of one agent, with its body and use counters                            |
| `memory_ledger`          | append-only log of every change, including declined items                         |

Kodama writes no SQL by hand. Queries use Drizzle's query builder, and migrations come only from
`drizzle-kit generate`. Each database has one folder under `packages/agents/drizzle/`, with its
schema beside the migrations generated from it:

```text
drizzle/
  memory/
    schema.ts        the long-term memory D1 schema
    migrations/      generated by `nr db:generate:memory`; applied with `cf d1 migrations apply`
  durable-object/
    schema.ts        kodama's tables in each Durable Object's SQLite
    migrations/      generated by `nr db:generate:durable-object`; applied by src/storage/local.ts
```

The schemas are written by hand. The `migrations/` folders are drizzle-kit output and are never
edited by hand. Tests fail when a schema and its generated migrations differ. drizzle-kit 0.31
does not inline the values of check constraints, so the typed columns and the code that writes them enforce allowed values. The
constraints in the schema are keys and relations between columns.

### Applying a write

Every change the memory agent makes is an operation with an `op_id`. For a tool call, the `op_id`
is the SHA-256 of the job ID and Pi's tool call ID, so running a recorded tool call again yields
the same `op_id`. For code steps, such as curation, it is built from the step and its target.
[`store/records.ts`](../packages/agents/src/memory/store/records.ts) applies it; `applyPlan` there
applies a batch that another module plans the same way, such as a skill write:

1. Look up `memory_ops` by `op_id`. If a row exists, return its stored result and change nothing.
2. Read the targets and check the operation's expectations. For example, the record to supersede
   must be `active` at the revision the operation names. If not, return `conflict` without
   writing.
3. Send one D1 `batch()` containing:
   - the `memory_ops` row;
   - guarded updates (`id`, `status = 'active'`, and `revision` all match) that set the next
     revision;
   - a `revision_claims` row for each next revision;
   - plain inserts of new records and their `memory_terms`;
   - the ledger row;
   - a new `scope_revisions` value.

Writes never ignore conflicts. A duplicate record ID or a replayed `op_id` fails a statement, and
`batch()` rolls the whole operation back.

Each change claims its next revision in `revision_claims`, whose primary key is the target and the
revision. A second writer that read the same revision fails on that key. Its update matched no row,
and it rolls back with the rest of its batch. The memory agent runs one job at a time (see
[Jobs](#jobs)), so the read in step 2 stays valid until step 3, and the constraints are the
backstop.

Working agents update only `use_count` and `last_used_at`, which do not change `revision`.

Other rules:

- Superseding names the old record: `memory_supersede(oldId, oldRevision, ...)`. Before writing,
  the memory agent finds candidates with `memory_search`; there is no topic key. The new record
  keeps the old record's scope. A record of another scope changes only through `overrides` or a
  checked shared write.
- A record's ID is the SHA-256 of its scope, kind, content, source agent, and first source entry.
- `superseded_by` is not a foreign key. D1 checks foreign keys immediately, and the old row is
  updated before the new row exists.
- Pi entry IDs are never reused, so checkpoints and archive ranges are keyed by agent and entry ID
  only.
- D1 binds at most 100 parameters per statement, so term rows are inserted in groups.

### Freshness

The order in which jobs run is not the order of the information. A candidate may supersede or
invalidate a record of the same source agent only if its `source_entry_to` is greater than the
record's. Otherwise the operation returns `stale` and the candidate is declined in the ledger. An
extraction of an old range therefore never undoes a newer `remember`. Invalidation carries the
same job-derived scope, source agent, and evidence as supersession; an extract job must cite its
supporting entries. Consolidation can invalidate records of its own scope without newer entries,
and code-driven cleanup supplies the target's ownership explicitly.

Entry IDs of different agents cannot be compared. A candidate never supersedes another agent's
record or a shared record directly; a shared record changes only through a checked shared write
(see [Shared memory](#shared-memory)). If the memory agent cannot settle a contradiction, the
contradiction stays as `conflict` in the ledger.

### Search text

[`src/lib/search-text.ts`](../packages/agents/src/lib/search-text.ts) is the one function
that produces words for records, archive indexes, and queries:

1. NFKC-normalize and lowercase.
2. Segment with `new Intl.Segmenter('ja', { granularity: 'word' })`, keeping word-like segments.
3. In each segment, remove `ー` after katakana.
4. Merge adjacent katakana segments into one word.
5. For stored text only, append the original segments that differ from the merged words.

`memory_terms` holds each distinct word of a record, written in the batch that writes the record.

A record matches a query when it has every merged word. If nothing matches, the search tries
again in two steps:

1. with the original segments;
2. with each merged word as a prefix. A prefix is a key range, from the word up to the word
   followed by U+10FFFF, so the primary key serves it.

`search_version` stores the version of this function, and consolidation rebuilds the terms of
records with an older version. Queries such as 「使う」, 「リポ」, and 「サーバレス」 find
records that say 「使います」, 「リポジトリ」, and 「サーバーレス」.

### Queries

- **Always-loaded memory**: the active `instruction` and `fact` records of the agent's scope and
  its shared spaces, with overrides applied in the query. They are ordered by `pinned`,
  `importance`, and `last_used_at`, and each block reads at most as many rows as lines could fit
  its budget (one line takes at least four characters), then is cut to the budget in code. See
  [Always-loaded memory](#always-loaded-memory).
- **`memory_search`**
  ([`store/search.ts`](../packages/agents/src/memory/store/search.ts)):
  1. For each word, join the active records of the allowed scopes that have it from
     `memory_terms`.
  2. Rank the records that have every word by importance and use, and events also by recency.
  3. Raise `use_count` and set `last_used_at` of the returned rows in one batch. A use counted
     twice at the same moment may be lost.
- **`history_search`**: see [Archive index](#archive-index).

## Memory agent

The memory agent is `MemoryAgent`, a subclass of `Agent`
([`src/system-agents/memory/agent.ts`](../packages/agents/src/system-agents/memory/agent.ts)).
It is a dedicated agent (see [agents.md](agents.md#dedicated-agents)): the object named
`kodama:memory` (`MEMORY_AGENT_NAME` in `jobs.ts`) in the `AGENTS` namespace is constructed as a
`MemoryAgent`, with no Durable Object class or binding of its own. It overrides `Agent`'s hooks to get its own
harness and configuration, and a job queue instead of chat input. Its folder holds only what the
role adds to an agent:

| File        | Contents                                                                    |
| ----------- | --------------------------------------------------------------------------- |
| `agent.ts`  | the `MemoryAgent` class: the overridden hooks and the job methods           |
| `config.ts` | its model, configuration, harness options, tool set, and prompts            |
| `runner.ts` | enqueueing, the drain that runs one job at a time, retries, and consolidate |

Queue persistence lives in `src/storage/memory-jobs.ts`.
Its dedicated model-facing tools live in `src/tools/memory-agent/`; daily consolidation is a memory workflow
in `src/memory/consolidation.ts`, backed by queries in `src/memory/store/maintenance.ts`.

- It inherits every method of `Agent`, including `subscribe`, `snapshot`, `submission`, and
  `getConfig`, so its work can be watched like any agent's.
- It is a registry row with `kind = 'dedicated'` and the fixed UUID
  `00000000-0000-7000-8000-00000000000a`, mapped to the object name `kodama:memory`.
  `AgentService` and `sendTo` admit only working agents, so they reject it. Jobs come only from working agents, pruning, and the `scheduled` handler, through `enqueue`,
  `jobStatus`, and `consolidate`; `Agent` declares them and rejects, and `MemoryAgent` overrides
  them.
- `sendMessage`, `send`, and `sendTo` throw, because input that bypassed the queue
  would break "one job at a time". `readEntries` and `memoryChanged` throw too: it keeps no memory
  of its own, so nothing extracts its entries or refreshes its prompt. `cancel` stops the running job, which the runner retries like a
  failure.
- Its model, prompt, and thinking level come from its configuration versions, like any agent's
  (see [agents.md](agents.md#configuration-versions)); its versions select no tools. The seed
  writes version 1 from `MEMORY_MODEL_PROVIDER` and `MEMORY_MODEL_ID`, or the default model
  (`DEFAULT_MODEL_*`) when they are empty, with the memory-keeping prompt
  (`src/system-agents/memory/config.ts`). Changing the variables later changes nothing; write a
  new version instead.
- It keeps no memory of its own and extracts nothing. Its own Pi session is pruned like any
  agent's, without an archive.

The memory agent's tools are registered only in its own harness, so working agents never get them:

| Tool                | Jobs                      | Effect                                                        |
| ------------------- | ------------------------- | ------------------------------------------------------------- |
| `memory_search`     | all model jobs            | search the job's scope and `shared:global`; ids and revisions |
| `memory_write`      | all model jobs            | write a new record                                            |
| `memory_supersede`  | all model jobs            | replace an active record named by id and revision             |
| `memory_invalidate` | all model jobs            | mark an active record as no longer true                       |
| `memory_decline`    | all model jobs            | decline the job's candidate, with the reason                  |
| `read_entries`      | `extract`                 | page through the source agent's entries after the checkpoint  |
| `finish_extraction` | `extract`                 | advance the checkpoint through the last entry covered         |
| `list_records`      | `consolidate`             | the scope's active records, by kind and then most used        |
| `list_skills`       | `consolidate` of an agent | the agent's skills with status and revision                   |
| `read_skill`        | `consolidate` of an agent | the body and evidence of one skill                            |
| `skill_write`       | `consolidate` of an agent | create or overwrite a skill                                   |
| `skill_archive`     | `consolidate` of an agent | archive or restore a skill                                    |
| `shared_write`      | `consolidate`             | write a shared record, checked first                          |

Each writing tool applies its change as an operation (see [Applying a write](#applying-a-write)).
During a `consolidate` job of a shared scope, every record write but a decline is refused, so that
job changes the space only through `shared_write` and its checks.

### Jobs

`enqueue(job)` validates the job with valibot and inserts it into `kodama_memory_jobs`, a table in
the memory agent's own SQLite outside Pi's tables
([`src/storage/memory-jobs.ts`](../packages/agents/src/storage/memory-jobs.ts)):

| Column                        | Meaning                                                       |
| ----------------------------- | ------------------------------------------------------------- |
| `job_id`                      | primary key: a hash of the job's identifying fields           |
| `kind`, `priority`, `payload` | the job                                                       |
| `status`                      | `queued`, `running`, or `settled`                             |
| `outcome`                     | `persisted`, `declined`, `conflict`, or `failed` once settled |
| `attempts`, `not_before`      | retry state                                                   |

The same job delivered twice gets the same ID, so a repeated `enqueue` returns the existing row.
`jobStatus(jobId)` reads a row.

| Kind          | Priority | Payload                            |
| ------------- | -------- | ---------------------------------- |
| `remember`    | 0        | source agent, content, entries     |
| `extract`     | 1        | source agent, entry to start after |
| `consolidate` | 2        | scope, UTC day                     |

One runner keeps at most one job in progress:

1. Take the queued job with the lowest priority number, then the oldest, whose `not_before` has
   passed, and mark it `running` with the time the attempt started. A job whose `not_before`
   passed more than an hour ago goes first, longest waiting first, whatever its priority, so a
   steady stream of `remember` and `extract` jobs cannot keep `consolidate` waiting forever.
2. Wait until the conversation is idle and call `reset()`, which Pi places at once while idle.
   Then submit the job prompt with the request ID `<jobId>-<attempt>`. Each job starts in a fresh
   context.
3. When the submission settles, derive the outcome from the job's `memory_ops` rows and mark the
   job `settled`. Then send `memoryChanged` to the source agent, if there is one.
4. Prune the memory agent's own session if needed, and only then take the next job. After the
   last due job, set the `jobs` alarm for the next delayed job.

While a job runs, the `jobs` alarm wakes the object every minute, so a job interrupted by eviction
resumes. A resumed attempt finds its submission in Pi by request ID and waits for it instead of
submitting again. The job queue does not keep a second submission ID: Pi owns submission identity
and task recovery, while Kodama owns job priority, retry timing, and the platform wakeup. A job
whose Pi submission already finished is settled from its stored operations without another model
call.

An attempt may run for 15 minutes. Provider failures are retried without limit inside an
attempt, so without a limit a failing provider would hold the one job in progress, and every job
behind it, forever. The heartbeat alarm stops an attempt past its limit, counted from its stored
start so an eviction does not restart it; its submission settles unanswered, and the job is
retried like a failure.

A failed job is retried after 1 minute, 10 minutes, and 1 hour. After that it settles `failed` with
a ledger row.

## Working agents

Every working agent gets the `kodama-memory` Pi extension
([`agent/memory-extension.ts`](../packages/agents/src/agent/memory-extension.ts)), whatever tools its
configuration enables:

- the tools `memory_search`, `history_search`, `remember`, and `skill_read`;
- the `memory` and `skills` prompt sections.

The memory-writing tools of the memory agent are not in this extension, and `AgentService` cannot
reach the memory agent.

The `remember` tool's description tells the model when to call it in the turn:

- the user asks to remember something or gives a standing instruction ("always", "from now on");
- the agent judges something worth keeping: a decision and its reason, a correction from the user,
  a lesson from a failure, or a durable fact it had to look up.

It also lists what not to keep: task progress, guesses, secrets, and one-off requests.

`remember` returns `accepted` with the job ID once the job is enqueued; it does not wait for the
memory model. At most three `remember` calls are accepted per user entry, counted in
`kodama_remember_turns`. Attribution uses the active execution's full durable input set, not the
newest transcript entry: the last adopted owner input anchors quota and evidence. Peer inputs
permanently establish external contact, so they cannot authorize remember requests. A remember request has no origin of its own; the memory agent treats every one the
same way, whether the user asked for it or the agent judged it worth keeping.

## Write paths

### Remember

1. Validate the input and cap its size at 2,000 characters.
2. Enqueue a `remember` job with the content and the source entry IDs. Return `accepted`.
3. The memory agent classifies the content, reconciles it with existing records, and writes it,
   superseding an earlier record it replaces. It may decline a duplicate or something of no
   lasting value, which is logged in the ledger. The record starts with the default importance
   (0.5) unless the memory agent sets one.
4. The job settles, and the working agent receives `memoryChanged`.

### Extract

An idle agent extracts its new entries. Ten minutes after the agent goes idle, its `extract` alarm
enqueues an `extract` job if entries exist after its checkpoint. Pruning also enqueues one when it
finds the checkpoint behind the range it archives.

1. `read_entries` pages through entries after the checkpoint. The entries come from the agent DO
   (`readEntries`), or from the R2 segment for a range already pruned. The memory agent persists
   the highest covered entry for the current job; pages cannot jump ahead of that read range.
   Agent-contact inputs retain their body and sender/hop preamble with role `peer`, distinct from
   human `user` input, in both live extraction and archived text/history search.
2. The model extracts candidate records. Each one cites the entries that support it, and code
   refuses a citation outside the job's range.
3. The model adds, supersedes, invalidates, or skips each candidate against existing records,
   subject to [Freshness](#freshness).
4. `finish_extraction` advances the checkpoint, guarded by its revision and bounded by the
   highest entry actually covered by `read_entries`. Citations use the same durable upper bound.

A failed extraction keeps the checkpoint and does not affect the conversation. Redelivering a
settled extraction queues it again if its checkpoint has not advanced, including when the model
finished without calling `finish_extraction`. Queued and running duplicates remain deduplicated.
The attempt counter stays monotonic to avoid replaying an old Pi submission; redelivery permits
another attempt without resetting the automatic retry budget.

### Consolidate

The cron trigger (`17 3 * * *`, UTC) calls `consolidate()` on the memory agent
([`consolidation.ts`](../packages/agents/src/memory/consolidation.ts)).

In code, it does the following, deleting in small batches:

- deletes settled jobs older than 30 days;
- deletes ledger rows and revision claims older than 90 days;
- rebuilds the terms of records with an old `search_version`;
- invalidates agent records that override a `required` shared record;
- archives skills unused for 30 days;
- enqueues one `consolidate` job for each scope changed in the last day, up to 200 scopes, in
  scope order starting after the last scope of the previous run and wrapping around, so the same
  scopes are not taken every day when more change;
- records the database size and the active records per scope in the ledger.

Settled-job and ledger deletion each repeat until no expired rows remain, up to 20 batches of
500 rows per daily run (10,000 rows per table). Remaining expired rows are eligible on the next
run; the 30/90-day windows are eligibility thresholds, not guaranteed deletion deadlines when
backlogs exceed that budget.

`memory_ops` is deliberately retained, unlike the diagnostic ledger: its stored results prevent
a replayed operation ID from applying the same write twice. There is no bounded replay horizon
that would make deleting these results safe, so the ledger's 90-day window does not apply to
operations. This table can continue to grow; database-size monitoring includes it. A bounded
operation-retention policy requires a replay-lifetime contract before deletion is introduced.

Each `consolidate` job reads its scope's active records with `list_records`, at most 200. It
then does the following:

- merges duplicates and resolves contradictions with `memory_supersede` and `memory_invalidate`;
- adjusts importance so the always-loaded memory fits its budget;
- creates, updates, and archives the agent's skills;
- writes records several agents keep to a shared space with `shared_write`.

## Always-loaded memory

[`working/always-loaded.ts`](../packages/agents/src/memory/working/always-loaded.ts) renders two
capped blocks from the always-loaded query:

- the agent's memory, at most 2,200 characters;
- a shared block, at most 1,000 characters.

Each block shows its budget, for example `[67% — 1,474/2,200 chars]`.

The agent object stores three things in `kodama_always_loaded`:

- the rendered text;
- the `scope_revisions` it was built from;
- the visible skill list.

The `memory` and `skills` sections read this stored copy, so a request never queries D1 for them.

The copy is refreshed while the agent is idle:

- when the object starts;
- when `memoryChanged` arrives (or at the next idle moment, if it arrives during a run);
- when a configuration version is applied, because `sharedSpaces` decides what the copy holds; a
  failed refresh fails the apply, so the version stays pending;
- before admitting input, if the last revision check is older than 60 seconds. One query reads
  `scope_revisions` for the agent's scope and shared spaces, and any newer revision re-renders the
  copy first.

A lost notice therefore delays an update until the next turn at most 60 seconds later, and no
change needs to wake every agent. A failed refresh is logged and keeps the previous copy, because
memory is an aid to the conversation, not a condition for it.

Pi appends a changed section to the conversation as a new message. Until compaction removes it,
the model sees the old version followed by the new one, marked as an update.

## Compaction

Kodama uses Pi's built-in compaction with its defaults and does not hook or replace it. Facts are
kept in memory records and the raw history in the archive, so a summary does not have to hold
everything.

## Alarms

A Durable Object has one alarm. [`alarms.ts`](../packages/agents/src/runtime/alarms.ts) stores a due
time per purpose under `kodama:alarm:<purpose>` and sets the platform alarm to the earliest one.

| Purpose    | Object       | Set by                                                        |
| ---------- | ------------ | ------------------------------------------------------------- |
| `recovery` | every agent  | admitted input; cleared when Pi has no runnable task          |
| `extract`  | working      | going idle (10 minutes later)                                 |
| `prune`    | every agent  | going idle with storage over the threshold, or a failed check |
| `jobs`     | memory agent | an enqueued job, a running job (every minute), the next retry |

`alarm()` takes every due purpose, refreshes recovery, and runs the rest. Each purpose clears only
its own time.

## Pruning

The agent DO archives and deletes old rows of its Pi session
([`prune/`](../packages/agents/src/memory/prune/)).

Let `P` be the `head` of the newest head marker in the root conversation. These rows are prunable:

- `entries` of the root conversation with an ID below `P`;
- terminal `tasks`, with their task-scoped `documents` and `document_revisions`;
- the matching `record_ids` rows.

`submissions` are kept. Pi stores no time on them, and `submissionByRequest` uses them to answer a
retried request with its first result. One row per input is small next to the entries.

When the agent goes idle, it schedules the `prune` alarm if either is true:

- a run is unfinished;
- `ctx.storage.sql.databaseSize` is above the threshold and entries before `P` remain.

The check reads storage only, so it also runs while the harness opens.

| Limit                      | Default | Meaning                            |
| -------------------------- | ------- | ---------------------------------- |
| threshold                  | 1 GiB   | prune while the database is larger |
| hard limit                 | 8 GiB   | above it, new input is refused     |
| bytes per run              | 16 MiB  | entries one run archives           |
| retry after a failed check | 10 min  | when the `prune` alarm tries again |

An operator can lower the limits of one object with the `kodama:prune-limits` storage key. Each run
covers at most 16 MiB of entries, so building its files fits the object's memory and CPU limits.
Runs repeat until the size is below the threshold.

A run's state is a row in `kodama_prune_runs`, a table outside Pi's tables. At most one run is
unfinished at a time.

| State      | What is confirmed                                             |
| ---------- | ------------------------------------------------------------- |
| `prepared` | the range from the last pruned entry, up to `P - 1`, is fixed |
| `exported` | the entries, manifest, and index are in R2 and verified       |
| `indexed`  | the `archive_segments` row is in D1                           |
| `deleted`  | the rows are gone from the Durable Object                     |

On start and on the `prune` alarm, an unfinished run continues from its state:

1. **Prepare.** Fix the range and record `prepared`. If the extraction checkpoint is below the
   range's end and the applied version extracts (`memoryPolicy.extract`), enqueue an `extract` job. Pruning does not wait for it, because extraction can read
   the segment from R2 later.
2. **Export.** Write three objects under `archive/<agentId>/<first>-<last>`:
   - the entries (`.jsonl`);
   - the manifest (`.manifest.json`): range, count, times, SHA-256, and the Pi Durable version;
   - the search index built in code (`.index.json`, see [Archive index](#archive-index)).

   Read them back to verify, and record `exported`. The keys depend only on the range, so a
   repeated export overwrites the same objects.

3. **Catalog.** Insert the `archive_segments` row, read it back, and record `indexed`.
4. **Delete.** Inside `blockConcurrencyWhile`, check again:
   - `harness.inspect()` reports no live task, background compaction included. A background
     compaction rereads entries from its recorded `tail` when it resumes.
   - The root is the only conversation.
   - No input or write submission is queued.
   - The newest head marker's `head` is still `P` or later.

   If any check fails, keep the run `indexed` and set the `prune` alarm 10 minutes later.
   Otherwise:
   1. Close the harness.
   2. In one `transactionSync`, delete the prunable rows of the run's range and record `deleted`.
   3. Reopen the harness and refresh the alarms.

   Requests that arrive meanwhile wait for the reopened harness. The section does only local
   SQLite work, so it stays far below the 30-second limit.

Steps 1–3 run while the agent keeps working; only step 4 needs it to be idle.

Above the hard limit, `sendMessage` rejects new input with a retryable `storage_maintenance` error
until a run reaches `deleted`. A busy agent therefore drains, and pruning gets its idle moment.
Pruning needs only R2 and D1, so a stopped memory agent delays extraction but not reclaiming
storage.

`readEntries` reads a range below the pruned boundary from its archived segment, so an extraction
that fell behind still sees every entry.

The memory agent prunes its own session the same way, without an archive. Its entries are the
scratch work of finished jobs, and its records are already in D1. It prunes after each job,
before taking the next, because closing the harness mid-job would fail the job, and waiting for
an empty queue would let the session grow without bound under a steady stream of jobs.

Pruning writes to Pi's internal tables, described in
[`src/storage/pi-tables.ts`](../packages/agents/src/storage/pi-tables.ts). The Pi Durable version
is pinned. Re-run `prune/prune.test.ts` and `src/runtime/harness.test.ts` on every Pi upgrade.

### Archive index

Each archived range has its search index in R2, next to its entries
([`archive/`](../packages/agents/src/memory/archive/)):

- **`.index.json`** is written by the pruning code. It splits the archived text into chunks of
  about 2,000 characters. The text is user and assistant messages, tool names and arguments, and
  the first 2,000 characters of each tool result. For each chunk, the index stores the entry range
  and the byte range in the `.jsonl` object. For each normalized word from the search-text
  function, it lists the chunks that contain the word. It also records its `search_version`.
- **The `archive_segments` row** in D1 is the catalog: range, times, size, and SHA-256. It is one
  small row per range.

Archived ranges have no summaries. A summary would need the memory agent's model to read the
raw entries, and the word index already finds them; it is the details a summary leaves out that
need to be found again.

The objects and the row are deleted only together, by an operator. Consolidation never expires
them.

`history_search(query, before?, cursor?)`:

1. List this agent's catalog rows newest first, with entry IDs breaking equal-time ties. A numeric
   `before` is an exclusive timestamp bound on chunks; overlapping segments remain eligible.
2. Read their `.index.json` objects in that order, until 4 MiB have been read.
3. Match the query against the chunks. A chunk matches when it contains every query word, tried
   in the same order as in [Search text](#search-text): the merged words, then the original
   segments, then each merged word as a prefix. At most five matches are returned, newest first.
4. Read the matched byte ranges from the `.jsonl` objects and return them with their entry IDs and
   times. When a result, read, or catalog-page limit stops the search, return an opaque `cursor`
   for the next unvisited segment or chunk. Pass it with the same query to continue; it preserves
   the original `before` bound. Entry IDs keep
   continuation lossless even when several chunks or segments have the same timestamp.

The internal result's `searchedBefore` remains the oldest visited time for display, not a
continuation token. `nextCursor` is absent and `complete` is true only after all eligible catalog
rows and matching chunks have been visited.

## Skills

A skill is a procedure the memory agent saved for one agent: a name, a description of when to use
it, and a Markdown body with the steps. Skills are kept apart from facts so that only their names
and descriptions occupy the prompt; the body is read when a task needs it.
[`skills.ts`](../packages/agents/src/memory/skills.ts) holds the pure rules and types;
[`store/skills.ts`](../packages/agents/src/memory/store/skills.ts) holds D1 reads and writes.

### Storage

Each skill is one row of the D1 `skills` table, body included, keyed by agent and name. The body
has at most 50,000 characters and the description at most 1,024.

A write is one operation (see [Applying a write](#applying-a-write)):

- it creates the skill, or overwrites it at the revision the writer read, and claims the next
  revision;
- the same batch writes the ledger row, with the body it replaced, and a new `scope_revisions`
  value for the agent, so its skill list refreshes like its memory.

One batch either happens or does not, so a stop never leaves a half-written skill. An earlier
version can be restored by writing the body the ledger kept. Archiving and restoring are
operations in the same way.

Skills are only agent skills. A procedure that several agents share is still kept per agent.

### Listing and loading

- The `skills` section lists the agent's active skills by name and description, at most 50, most
  recently used first. The list is stored and refreshed with the always-loaded memory.
- The model reads a listed skill with the `skill_read` tool, by name. A name the agent does not
  have, or an archived skill, returns an error.
- Each read raises the skill's `use_count` and sets `last_used_at`, which never change `revision`.

### Lifecycle

All changes are operations of the memory agent during an agent's `consolidate` job, or of the
daily consolidation in code, logged in `memory_ledger`.

- **Create.** A skill comes from a procedure that succeeded at least twice in the agent's entries,
  with those entry ranges and the failure lessons as evidence. The memory agent writes it with
  `skill_write`.
- **Update.** The memory agent overwrites it from new evidence, passing the revision it read.
- **Archive.** The memory agent archives a skill the records show is wrong. The daily
  consolidation archives skills that were neither used nor written for 30 days. An archived skill
  can be restored with `skill_archive`.

## Shared memory

- Agents read the shared spaces listed in their `sharedSpaces` configuration: at most eight unique
  names of lowercase letters, digits, and hyphens. They are stored under `kodama:shared-spaces`
  beside the configuration Pi keeps
  ([`configuration/index.ts`](../packages/agents/src/configuration/index.ts)).
- An agent record overrides a shared record through `memory_write`'s `overrides`.
- Content from untrusted sources is stored as an `event` with its source. One agent's
  conversation alone never reaches a shared space.

### Writing shared records

No person approves or reviews a change. During a `consolidate` job, the memory agent writes a
shared record with `shared_write`, and code checks it before applying it
([`shared.ts`](../packages/agents/src/memory/shared.ts)):

- A record that comes into a space needs active records of at least two agents among its sources.
  Two agents are independent evidence that it is not one agent's quirk or one poisoned
  conversation.
- Reorganizing a space (merging or replacing its records) needs sources that are all active
  records of that space, and only the `consolidate` job of that space may do it. A job of one
  agent's scope reads that agent's records, so citing the space's records there would let one
  agent's conversation rewrite the space.
- `required` needs records of two agents, or sources that are already required.

A write that passes is applied as one operation: a new record, or a supersede of the shared record
it replaces at its current revision. A write that fails changes nothing but the ledger, and the
tool tells the memory agent why. Shared records are never rewritten in place.

## Settings

| Setting                            | Value                                                                                  | Where                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------- |
| memory agent model                 | its configuration versions; version 1 from `MEMORY_MODEL_PROVIDER` / `MEMORY_MODEL_ID` | the management database, `cloudflare.config.ts` |
| `sharedSpaces`                     | `["global"]`, at most 8                                                                | configuration versions                          |
| idle delay before `extract`        | 10 minutes                                                                             | `src/agent/memory.ts`                           |
| always-loaded budget               | 2,200 characters (agent), 1,000 (shared)                                               | `working/always-loaded.ts`                      |
| revision check before input        | every 60 seconds at most                                                               | `working/always-loaded.ts`                      |
| `remember` calls per user entry    | 3                                                                                      | `working/remember.ts`                           |
| `remember` content                 | at most 2,000 characters                                                               | `jobs.ts`                                       |
| event half-life                    | 30 days                                                                                | `store/search.ts`                               |
| job retries                        | 1 minute, 10 minutes, 1 hour                                                           | `src/system-agents/memory/runner.ts`            |
| job attempt time limit             | 15 minutes                                                                             | `src/system-agents/memory/runner.ts`            |
| job starvation limit               | 1 hour past its due time                                                               | `src/storage/memory-jobs.ts`                    |
| consolidation job size             | one scope, 200 records; 200 scopes a day                                               | `consolidation.ts`                              |
| ledger and claim retention         | 90 days                                                                                | `consolidation.ts`                              |
| settled job retention              | 30 days                                                                                | `consolidation.ts`                              |
| pruning threshold / hard limit     | 1 GiB / 8 GiB                                                                          | `prune/runs.ts`                                 |
| entries per pruning run            | at most 16 MiB                                                                         | `prune/runs.ts`                                 |
| pruning retry after a failed check | 10 minutes                                                                             | `prune/runs.ts`                                 |
| archive chunk / tool result text   | 2,000 / 2,000 characters                                                               | `archive/segment.ts`, `transcript.ts`           |
| `history_search` index read        | 4 MiB per call, 5 matches                                                              | `archive/history.ts`                            |
| skill body / description           | 50,000 / 1,024 characters                                                              | `skills.ts`                                     |
| skills listed per agent            | 50                                                                                     | `skills.ts`                                     |
| skill archived when unused         | 30 days                                                                                | `skills.ts`                                     |
| agents needed for a shared record  | 2                                                                                      | `shared.ts`                                     |

## Testing

Memory is tested in workerd with a mocked model, like the rest of the agent (see
[agents.md](agents.md#testing)). Each test sits next to the module it tests; shared
setup lives in `src/helper/memory.ts`. Paths below are relative to
`src/memory/` unless they start with `src/`.

| Test file                                 | Covers                                                             |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `store/records.test.ts`                   | operations: replays, conflicts, freshness, revision claims, checks |
| `store/search.test.ts`                    | Japanese and English queries, scopes, precedence, usage counts     |
| `src/system-agents/memory/runner.test.ts` | jobs, `remember`, redelivery, retries, recovery after eviction     |
| `src/system-agents/memory/agent.test.ts`  | the role's RPC limits, the default model, its class                |
| `consolidation.test.ts`                   | merging duplicates and dropping old ledger rows                    |
| `src/agent/memory.test.ts`                | extraction, the always-loaded copy, revision checks                |
| `src/runtime/alarms.test.ts`              | purposes coexist in one alarm                                      |
| `prune/prune.test.ts`                     | pruning states, stops, delete checks, the hard limit; evaluation   |
| `archive/history.test.ts`                 | `history_search` pages, time bounds, and continuation cursors      |
| `store/skills.test.ts`                    | writes and conflicts, `skill_read`, curation, the consolidate job  |
| `shared.test.ts`                          | shared spaces, overrides, required records, checked shared writes  |
| `src/runtime/harness.test.ts`             | behavior of Pi Durable that this design relies on                  |
| `store/db.test.ts`                        | behavior of D1 that this design relies on                          |
| `drizzle/*/schema.test.ts`                | each schema matches its generated migrations                       |

### Evaluation

The `evaluation after pruning` tests in `prune/prune.test.ts` run probe questions with a scripted model, after pruning and eviction.
They check the following:

- the decision is in the always-loaded memory, and the early turns are in the summary;
- `history_search` finds a word that only the pruned entries hold;
- a superseded decision leaves the newest memory section;
- an unknown topic finds nothing;
- a `before` bound older than the archive finds nothing;
- a retried request ID from the pruned range returns its first submission.

With a scripted model, these probes check what reaches the context, not how well a model uses it.

### Pi Durable assumptions

The design relies on this behavior of Pi Durable 1.2.0 and D1. `src/runtime/harness.test.ts` pins
the first two, and `store/db.test.ts` the third:

- In Pi Durable 1.2.0, `reset()` resolves once the reset is admitted, not placed. A reset placed
  at a later boundary could cut the next job, or leak the previous job's context into it. With one
  job at a time and the reset admitted while idle, Pi places it at once, before the next input.
- Pi's idle wait does not include background tasks. A background compaction rereads entries from
  its recorded `tail` when it resumes, so pruning checks `inspect()` right before it deletes.
- D1's `batch()` rolls back every statement when one fails, which is what makes a replayed or
  conflicting operation change nothing.
- Pi entry and record IDs come from a counter and are never reused, even after deletion.

## Design decisions

### Memory lives outside the agent's Durable Object

The Pi session stays in the Durable Object. Long-term memory and skills go to D1, and raw entries
go to R2. Per row and per GB, a Durable Object is not more expensive than D1, so cost is not
the reason. Memory moves out because of three requirements:

- agents share memory;
- a UI and maintenance jobs read memory without waking agent objects;
- the session's own rows are pruned over time.

R2 stores large data at about one fiftieth of D1's price per GB, and its archive index grows with
the transcripts. D1 is one database of at most 10 GB for all agents.

Rejected:

- one Durable Object per memory scope, because a UI or job would wake objects to read;
- markdown files only in R2, because R2 has no transactions and search needs a separate index;
- Cloudflare Agent Memory, which is close to this design but in private beta. The memory store
  stays behind kodama's own module so it can be swapped later.

### Compaction is left to Pi

Pi already selects the cut, summarizes in a structured format, carries the earlier summary forward,
retries, and recovers from context overflow. Summaries lose details over repeated passes, so kodama
covers that loss with records and the raw archive, not with its own summarizer.

### Raw entries are archived, indexed, and pruned

A retrievable archive keeps old details findable, while overwrite-only summaries lose them more as
compaction becomes more frequent. The raw entries are indexed, not only their summary, because what
needs to be found again is often what the summary left out, such as an error code.

Rejected:

- never pruning, because the object fails hard at its 10 GB limit;
- wiping the object and restarting from a handoff note, because it breaks the conversation's
  continuity and drops every subscriber;
- waiting for an official pruning API in Pi Durable. That would be the better end state, so
  pruning stays in one module.

### One memory agent writes, through a job queue

Memory editing in the conversing agent makes it slower and less reliable, spends the working model
on bookkeeping, and leaves several writers per scope. One writer running one job at a time gives
each scope one writer, and it can use its own model. The memory agent is an `Agent` subclass under a
reserved name in the same namespace, so public RPC cannot reach it, its tools live in a separate registry, and its work
stays observable like any agent's.

A Cloudflare Workflow was rejected. It would rebuild durable admission, deduplication, and
recovery, which `Agent` already provides, with a second execution model.

### Three write paths

- `remember` runs in the turn, when asked or when the agent judges something worth keeping.
- Extraction runs from the transcript while the agent is idle.
- Consolidation runs once a day.

Extraction reads the transcript, not the compaction, because compaction removes nothing from
storage.

Memory systems accumulate errors during extraction, and any user can try to inject memory. Two
rules follow:

- candidates must cite the entries that support them;
- the memory agent may decline a remember request it finds duplicated or of no lasting value.

### Four kinds; facts are superseded, events decay

Facts do not decay with time; they become outdated only when something newer replaces them. A
newer fact therefore supersedes an older one by naming its ID. Events are ranked down by recency
instead.

Topic keys were rejected. They work only if the model produces the same key for the same topic
every time, and one writer makes the database guarantee they would give unnecessary.

### Search is a word index, not FTS5 or vectors

FTS5 needs a virtual table and triggers that Drizzle cannot describe, and kodama writes no SQL by
hand. Its trigram tokenizer also misses two-character Japanese words such as 「使う」. A word table
loses BM25's term-frequency ranking, which matters little for records of one or two sentences.

Vectors may be added once measurements show what word search misses.

### Skills come only from verified experience and stay few

Skills induced from verified successful trajectories help. Skills an agent writes before doing the
work hurt, and selection accuracy drops as the library grows. Hence the rules:

- a skill needs a procedure that succeeded at least twice;
- an agent sees at most 50 skills;
- unused skills are archived.

A skill is one row with one Markdown body. Bundled files, a virtual file system for Pi's `read`
tool, and shared skills were tried and removed: they needed a write journal, content-addressed
blobs, and recovery code for little use. `skill_read` by name is enough to load a listed skill.

### Shared memory needs a second agent, not a person

Agents run unattended for months, so a person in the loop would leave changes waiting and shared
memory stale. A second agent's independent record is the confirmation instead: one poisoned
conversation or one agent's quirk cannot reach every agent on its own.

The check and the write happen in one tool call, so there is no pending state to recover. A
replacement supersedes the shared record at the revision just read, so a change made meanwhile
turns it into a `conflict` instead of being undone.

## Known limits

- Whether `databaseSize` falls after pruning in production is not verified. Locally, it fell from
  20.5 MB to 5.1 MB.
- `submissions` are never pruned; one row per input stays for the life of the agent.
- Conversation, memory-record, and skill content is not redacted. Credentials are kept outside model
  context and result fields; secrets pasted into ordinary content are not detected or removed.
  Text written as instructions is not rejected. The archive keeps raw entries as they were.
- 「プラクティス」 alone does not match 「ベストプラクティス」.
- `history_search` has no ranking across all ranges, and finding something old can take several
  calls with a continuation `cursor`.
- D1 is one database for all agents. Consolidation records its size, but when to split it is not
  decided.
- The 30-day skill window, the two agents needed for a shared record, and the 50-skill limit are
  kodama's choices, not measured values.

## Open questions

- How long must archived entries be kept, and who may delete them?
- Which model should the memory agent use?
- How coarse may live streaming to the UI become in exchange for fewer writes?

## External-contact extraction boundary

A root's first web, peer or history contact persists the last extraction-eligible entry ID in
object SQLite. `remember` is refused both before execution and in the serialized quota/enqueue
section. There is no post-contact human-only escape hatch or automatic reset.

Extraction enqueue freezes any known upper bound; source entry reads reapply the current bound
for both live SQLite and archived R2 pages. All post-boundary text (including owner messages,
tools, assistants and compaction summaries) is excluded. Page `through` still advances over
excluded entries so checkpoints do not stall. The source object serializes final extraction
writes with contact admission and rechecks evidence against its current boundary, protecting
already queued/running jobs and reads that raced contact. A checkpoint is scan progress, not
permission to write unread evidence. Reading archived history marks contact before exposing its
result to the model. Memory layers remain independent of runtime orchestration.
