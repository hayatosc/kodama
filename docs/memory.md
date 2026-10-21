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

| Store                        | Binding        | Contents                                                                                    |
| ---------------------------- | -------------- | ------------------------------------------------------------------------------------------- |
| Agent Durable Object         | `AGENTS`       | Pi Durable session; always-loaded copy and skill list; pruning state; alarm schedule        |
| `MemoryAgent` Durable Object | `MEMORY_AGENT` | the memory agent (one instance, named `memory`) and its job queue                           |
| D1 database                  | `MEMORY_DB`    | memory records, applied operations, revisions, archive catalog, skill index, proposals, log |
| R2 bucket                    | `ARCHIVE`      | archived entries and their indexes (`archive/`); skills and skill blobs (`skills/`)         |

```text
AgentService (public RPC entrypoint)
  `-- AGENTS ---------------------> Agent DO (agentId)   MemoryAgent is not reachable from here

Agent DO (agentId)
  |-- reads ----------------------> D1 MEMORY_DB         memory_search, always-loaded query, revisions
  |-- writes ---------------------> D1 MEMORY_DB         usage counters, archive catalog (pruning)
  |-- read (SkillsEnv) -----------> R2 ARCHIVE           SKILL.md and bundled files
  |-- reads and writes -----------> R2 ARCHIVE           archived entries and indexes, history_search
  `-- MEMORY_AGENT.enqueue -------> MemoryAgent DO       remember, extract, record_archive

MemoryAgent DO ("memory")
  |-- reads and writes -----------> D1 MEMORY_DB
  |-- reads and writes -----------> R2 ARCHIVE           archived entries, summaries, skills, blobs
  |-- AGENTS readEntries ---------> Agent DO             paged entries for extraction
  |-- AGENTS getConfig -----------> Agent DO             shared spaces, when a proposal is applied
  `-- AGENTS memoryChanged -------> Agent DO             refresh hint; revisions are the record

scheduled handler (17 3 * * *) -> MemoryAgent DO       consolidate
```

Only the memory agent changes memory records and skills. Working agents write only usage counters
and, while pruning, the archive catalog of their own entries.

### Code layout

| Path            | Contents                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------- |
| `store/`        | operations and how they are applied, search text, search, scopes                              |
| `memory-agent/` | `MemoryAgent`, its job queue, harness, prompts, daily consolidation, and its tools (`tools/`) |
| `working/`      | what every working agent gets: tools, the always-loaded memory, and the Pi extension          |
| `archive/`      | archived segments in R2: building, reading, and `history_search`                              |
| `prune/`        | the pruning state machine and its limits                                                      |
| `skills/`       | skill paths, blobs, writes, status, usage, curation, and `SkillsEnv`                          |
| `shared/`       | shared proposals: their checks (`proposals.ts`) and their application (`apply.ts`)            |
| `jobs.ts`       | the memory agent's input contract: job kinds, their validation, and the object's name         |
| `transcript.ts` | the text of Pi entries that extraction and archives read                                      |

The schemas live next to their migrations under
[`packages/agents/drizzle/`](../packages/agents/drizzle/), one folder per database (see
[D1 schema](#d1-schema)). Kodama's own tables in each Durable Object's SQLite are in
[`drizzle/durable-object/schema.ts`](../packages/agents/drizzle/durable-object/schema.ts): the
memory agent's job queue, the per-turn `remember` count, the always-loaded copy, and pruning runs.
The search-text function and the redaction checks are generic helpers in
[`src/lib/`](../packages/agents/src/lib/). How the folders may depend on each other is described
in [agents.md](agents.md#dependencies).

## Memory model

### Scopes

| Scope                                          | Contents                                       | Writer                                  |
| ---------------------------------------------- | ---------------------------------------------- | --------------------------------------- |
| `agent:<agentId>`                              | the agent's notes, conventions, events, skills | memory agent                            |
| `shared:<space>` (for example `shared:global`) | team conventions, shared facts, shared skills  | memory agent, through checked proposals |

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
`user_request`, `agent_judgment`, `extraction`, `consolidation`, or `proposal`. The code that
builds a record from a job sets the scope, origin, source agent, and cited entries, so the model
never chooses them. Summaries of archived entries are not memory records; they live next to the
archived entries in R2. Hard deletion is an operator action.

### D1 schema

The schema is defined with Drizzle in
[`drizzle/d1/schema.ts`](../packages/agents/drizzle/d1/schema.ts): one schema file for the one
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
| `skills`                 | skill index: name, description, status, content hash                              |
| `skill_writes`           | a skill update recorded before its files are overwritten                          |
| `skill_usage`            | skill uses per agent                                                              |
| `shared_proposals`       | proposals for shared memory, their decisions, and their application               |
| `memory_ledger`          | append-only log of every change, including declined items                         |

Kodama writes no SQL by hand. Queries use Drizzle's query builder, and migrations come only from
`drizzle-kit generate`. Each database has one folder under `packages/agents/drizzle/`, with its
schema beside the migrations generated from it:

```text
drizzle/
  d1/
    schema.ts        the D1 schema
    migrations/      generated by `nr db:generate`; applied with `cf d1 migrations apply`
  durable-object/
    schema.ts        kodama's tables in each Durable Object's SQLite
    migrations/      generated by `nr db:generate:local`; applied by src/storage/local.ts
```

The schemas are written by hand. The `migrations/` folders are drizzle-kit output and are never
edited by hand. Tests fail when a schema and its generated migrations differ. drizzle-kit 0.31 does not inline the values of check
constraints, so the typed columns and the code that writes them enforce allowed values. The
constraints in the schema are keys and relations between columns.

### Applying a write

Every change the memory agent makes is an operation with an `op_id`. For a tool call, the `op_id`
is the SHA-256 of the job ID and Pi's tool call ID, so running a recorded tool call again yields
the same `op_id`. For code jobs, it is built from the job or proposal ID and the step.
[`store/records.ts`](../packages/agents/src/memory/store/records.ts) applies it:

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
  shared proposal.
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
extraction of an old range therefore never undoes a newer `remember`.

Entry IDs of different agents cannot be compared. A candidate never supersedes another agent's
record or a shared record directly. It becomes a shared proposal with a `base_revision` instead.
If the memory agent cannot settle a contradiction, the contradiction stays as `conflict` in the
ledger, and the memory agent may propose again against the current revision.

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
  its shared spaces, with overrides applied. They are ordered by `pinned`, `importance`, and
  `last_used_at`, then cut to a character budget in code. See
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

[`MemoryAgent`](../packages/agents/src/memory/memory-agent/memory-agent.ts) extends `Agent`. It is
exported as its own Durable Object class, with one instance named `memory`.

- It inherits `Agent` as it is, including `subscribe`, `snapshot`, and `submission`. A UI can later
  watch its jobs through an authenticated `AgentService` method.
- It is not part of `AgentService`. Jobs come only from working agents, pruning, its own accepted
  proposals, and the `scheduled` handler.
- `sendMessage`, `send`, and `sendTo` throw, because input that bypassed the queue would break
  "one job at a time". `cancel` stops the running job, which the runner retries like a failure.
- Its configuration is fixed in code: the model is `MEMORY_MODEL_PROVIDER` and `MEMORY_MODEL_ID`
  (the default model when they are empty), with the memory-keeping system prompt in
  `memory-agent/prompts.ts`. `setConfig` throws.
- `Agent` has protected factories for its harness options, default configuration, idle and alarm
  handling, and pruning. `MemoryAgent` overrides them.
- It keeps no memory of its own and extracts nothing. Its own Pi session is pruned like any
  agent's, without an archive.

The memory agent's tools are registered only in its own harness, so working agents never get them:

| Tool                    | Jobs                      | Effect                                                        |
| ----------------------- | ------------------------- | ------------------------------------------------------------- |
| `memory_search`         | all model jobs            | search the job's scope and `shared:global`; ids and revisions |
| `memory_write`          | all model jobs            | write a new record                                            |
| `memory_supersede`      | all model jobs            | replace an active record named by id and revision             |
| `memory_invalidate`     | all model jobs            | mark an active record as no longer true                       |
| `memory_decline`        | all model jobs            | decline the job's candidate, with the reason                  |
| `read_entries`          | `extract`                 | page through the source agent's entries after the checkpoint  |
| `finish_extraction`     | `extract`                 | advance the checkpoint through the last entry covered         |
| `read_archive`          | `record_archive`          | read the entries of the archived segment                      |
| `write_archive_summary` | `record_archive`          | store the segment's summary                                   |
| `list_records`          | `consolidate`             | the scope's active records, by kind and then most used        |
| `list_skills`           | `consolidate` of an agent | the scope's skills with status and revision                   |
| `read_skill`            | `consolidate` of an agent | one file of a skill of the scope                              |
| `skill_write`           | `consolidate` of an agent | create or overwrite an agent skill                            |
| `skill_archive`         | `consolidate` of an agent | archive or restore a skill                                    |
| `shared_propose`        | `consolidate`             | propose a change to a shared space                            |

Each writing tool applies its change as an operation (see [Applying a write](#applying-a-write)).
During a `consolidate` job of a shared scope, every write but a decline is refused, so that job can
only propose.

### Jobs

`enqueue(job)` validates the job with valibot and inserts it into `kodama_memory_jobs`, a table in
the memory agent's own SQLite outside Pi's tables
([`memory-agent/queue.ts`](../packages/agents/src/memory/memory-agent/queue.ts)):

| Column                        | Meaning                                                                 |
| ----------------------------- | ----------------------------------------------------------------------- |
| `job_id`                      | primary key: a hash of the job's identifying fields, or the proposal ID |
| `kind`, `priority`, `payload` | the job                                                                 |
| `status`                      | `queued`, `running`, or `settled`                                       |
| `outcome`                     | `persisted`, `declined`, `conflict`, or `failed` once settled           |
| `attempts`, `not_before`      | retry state                                                             |

The same job delivered twice gets the same ID, so a repeated `enqueue` returns the existing row.
`jobStatus(jobId)` reads a row.

| Kind             | Runs in | Priority | Payload                                |
| ---------------- | ------- | -------- | -------------------------------------- |
| `remember`       | model   | 0        | source agent, origin, content, entries |
| `apply_proposal` | code    | 1        | proposal ID                            |
| `record_archive` | model   | 1        | source agent, segment ID               |
| `extract`        | model   | 2        | source agent, entry to start after     |
| `consolidate`    | model   | 3        | scope, UTC day                         |

One runner keeps at most one job in progress:

1. Between jobs, queue an `apply_proposal` for every accepted proposal, and finish any pending
   skill write.
2. Take the queued job with the lowest priority number, then the oldest, whose `not_before` has
   passed, and mark it `running`.
3. Run the job:
   - **Model job.** Wait until the conversation is idle and call `reset()`, which Pi places at
     once while idle. Then submit the job prompt with the request ID `<jobId>-<attempt>`. Each job
     starts in a fresh context.
   - **Code job.** Run it in code, without Pi.
4. When the submission settles, derive the outcome from the job's `memory_ops` rows and mark the
   job `settled`. Then send `memoryChanged` to the source agent, if there is one.
5. Only then take the next job. After the last due job, prune the memory agent's own session if
   needed, and set the `jobs` alarm for the next delayed job.

While a job runs, the `jobs` alarm wakes the object every minute, so a job interrupted by eviction
resumes. A resumed attempt finds its submission by request ID and waits for it instead of
submitting again.

A failed job is retried after 1 minute, 10 minutes, and 1 hour. After that it settles `failed` with
a ledger row.

## Working agents

Every working agent gets the `kodama-memory` Pi extension
([`working/extension.ts`](../packages/agents/src/memory/working/extension.ts)), whatever tools its
configuration enables:

- the tools `memory_search`, `history_search`, `remember`, and Pi Durable's `read` tool for
  skills;
- the `memory` and `skills` prompt sections;
- an `afterTool` hook that counts skill uses.

The memory-writing tools of the memory agent are not in this extension, and `AgentService` cannot
reach the memory agent.

The `remember` tool's description tells the model when to call it in the turn:

- the user asks to remember something or gives a standing instruction ("always", "from now on");
- the agent judges something worth keeping: a decision and its reason, a correction from the user,
  a lesson from a failure, or a durable fact it had to look up.

It also lists what not to keep: task progress, guesses, secrets, and one-off requests.

`remember` returns `accepted` with the job ID once the job is enqueued; it does not wait for the
memory model. At most three `remember` calls are accepted per user entry, counted in
`kodama_remember_turns`.

## Write paths

### Remember

1. Validate the input, cap its size at 2,000 characters, redact secrets, and reject text that tries
   to instruct the memory system ([`src/lib/redact.ts`](../packages/agents/src/lib/redact.ts)).
2. Enqueue a `remember` job with the content, its origin (`user_request` or `agent_judgment`), and
   the source entry IDs. Return `accepted`.
3. The memory agent classifies the content, reconciles it with existing records, and writes it:
   - `user_request` is written as asked, superseding an earlier record it replaces. It starts with
     importance 0.7.
   - `agent_judgment` may be declined as a duplicate or of low value, which is logged in the
     ledger. It starts with importance 0.4.
4. The job settles, and the working agent receives `memoryChanged`.

### Extract

An idle agent extracts its new entries. Ten minutes after the agent goes idle, its `extract` alarm
enqueues an `extract` job if entries exist after its checkpoint. Pruning also enqueues one when it
finds the checkpoint behind the range it archives.

1. `read_entries` pages through entries after the checkpoint. The entries come from the agent DO
   (`readEntries`), or from the R2 segment for a range already pruned.
2. The model extracts candidate records. Each one cites the entries that support it, and code
   refuses a citation outside the job's range.
3. The model adds, supersedes, invalidates, or skips each candidate against existing records,
   subject to [Freshness](#freshness).
4. `finish_extraction` advances the checkpoint, guarded by its revision, and marks the segments the
   range completes as extracted.

A failed extraction keeps the checkpoint and does not affect the conversation.

### Consolidate

The cron trigger (`17 3 * * *`, UTC) calls `MemoryAgent.consolidate()`
([`memory-agent/consolidation.ts`](../packages/agents/src/memory/memory-agent/consolidation.ts)).

In code, it does the following, deleting in small batches:

- deletes settled jobs older than 30 days;
- deletes ledger rows and revision claims older than 90 days;
- rebuilds the terms of records with an old `search_version`;
- invalidates agent records that override a `required` shared record;
- finishes pending skill writes;
- curates unused skills;
- deletes skill blobs that no retained ledger row or pending skill write references and that are
  older than one day;
- enqueues one `consolidate` job for each scope changed in the last day, up to 200 scopes;
- records the database size and the active records per scope in the ledger.

Each `consolidate` job reads its scope's active records with `list_records`, at most 200. It
then does the following:

- merges duplicates and resolves contradictions with `memory_supersede` and `memory_invalidate`;
- adjusts importance so the always-loaded memory fits its budget;
- creates, updates, and archives agent skills;
- prepares shared proposals.

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
- when `setConfig` stores the configuration, because `sharedSpaces` decides what the copy holds;
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

A Durable Object has one alarm. [`AlarmSchedule`](../packages/agents/src/agent/alarms.ts) stores a due
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
   range's end, enqueue an `extract` job. Pruning does not wait for it, because extraction can read
   the segment from R2 later.
2. **Export.** Write three objects under `archive/<agentId>/<first>-<last>`:
   - the entries (`.jsonl`);
   - the manifest (`.manifest.json`): range, count, times, SHA-256, and the Pi Durable version;
   - the search index built in code (`.index.json`, see [Archive index](#archive-index)).

   Read them back to verify, and record `exported`. The keys depend only on the range, so a
   repeated export overwrites the same objects.

3. **Catalog.** Insert the `archive_segments` row, read it back, and record `indexed`. Then enqueue
   `record_archive` for the summary.
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
Pruning needs only R2 and D1, so a stopped memory agent delays extraction and summaries but not
reclaiming storage.

`readEntries` reads a range below the pruned boundary from its archived segment, so an extraction
that fell behind still sees every entry.

The memory agent prunes its own session the same way, without an archive. Its entries are the
scratch work of finished jobs, and its records are already in D1. It prunes between jobs, at the
end of each drain, because closing the harness mid-job would fail the job.

Pruning writes to Pi's internal tables, described in
[`src/storage/pi-tables.ts`](../packages/agents/src/storage/pi-tables.ts). The Pi Durable version
is pinned. Re-run `prune/prune.test.ts` and `src/storage/pi-assumptions.test.ts` on every Pi upgrade.

### Archive index

Each archived range has its search index in R2, next to its entries
([`archive/`](../packages/agents/src/memory/archive/)):

- **`.index.json`** is written by the pruning code. It splits the archived text into chunks of
  about 2,000 characters. The text is user and assistant messages, tool names and arguments, and
  the first 2,000 characters of each tool result. For each chunk, the index stores the entry range
  and the byte range in the `.jsonl` object. For each normalized word from the search-text
  function, it lists the chunks that contain the word. It also records its `search_version`.
- **`.summary.json`** is written by the `record_archive` job: the summary and its normalized
  words. Writing it sets `has_summary` on the catalog row.
- **The `archive_segments` row** in D1 is the catalog: range, times, size, SHA-256, and whether
  extraction and the summary are done. It is one small row per range.

The objects and the row are deleted only together, by an operator. Consolidation never expires
them.

`history_search(query, before?)`:

1. List this agent's catalog rows newest first, starting before `before` if given.
2. Read their `.summary.json` and `.index.json` objects in that order, until 4 MiB have been read.
3. Match the query against the chunks. A chunk matches when it contains every query word, tried
   in the same order as in [Search text](#search-text): the merged words, then the original
   segments, then each merged word as a prefix. A summary matches the same way. At most five
   matches are returned, newest first.
4. Read the matched byte ranges from the `.jsonl` objects and return them with their entry IDs and
   times. Also return the oldest time searched, which the model passes as `before` to search
   further back.

## Skills

Skills follow the Agent Skills format: a directory with a `SKILL.md` file (frontmatter `name` and
`description`) and optional `references/`, `assets/`, and `scripts/` directories. They are kept
apart from facts so that only their name and description occupy the prompt, and the body is read
when a task needs it.

### Scopes and visibility

| Scope             | Visible to                                    | Changed by                                     |
| ----------------- | --------------------------------------------- | ---------------------------------------------- |
| `agent:<agentId>` | that agent                                    | memory agent                                   |
| `shared:<space>`  | agents whose `sharedSpaces` include `<space>` | memory agent, only through an applied proposal |

An agent skill shadows a shared skill with the same name. Between shared spaces, the earlier space
in `sharedSpaces` wins. Each name appears once in the listing.

A skill's status is `proposed`, `active`, `stale`, or `archived`.

### Storage

[`skills/write.ts`](../packages/agents/src/memory/skills/write.ts) stores each skill as one R2
directory, `skills/<scope>/<name>/`, overwritten in place on update. The `skills` row holds
`content_sha256` (over each path and its file's SHA-256) and `revision`.

A skill has at most 32 files of at most 256 KiB each. Paths are `SKILL.md` or below
`references/`, `assets/`, or `scripts/`.

An update is one operation. It is recorded before any file changes, so a stop can be finished:

1. Upload the new files to `skills/.blobs/<sha256>`. Also copy there each file that will be
   overwritten or removed. Blobs are content-addressed, so a file is stored once.
2. Insert a `pending` `skill_writes` row with the `op_id` and each changed path's before and after
   SHA-256.
3. Overwrite and remove the files in the skill directory, supporting files first and `SKILL.md`
   last.
4. In one `batch()`, do the following:
   - update `content_sha256`, guarded by `revision`;
   - write the ledger row with the per-file hashes;
   - write the new `scope_revisions` value and the `memory_ops` row;
   - mark the `skill_writes` row `done`.

Before each job and during daily consolidation, the memory agent finishes every pending
`skill_writes` row. It copies the after blobs into the directory again and runs step 4. Step 3
writes the same bytes each time, so a stop at any point ends in the new version.

A rollback is an operation that writes a ledger row's before blobs back in the same way.

A read during an update can see old and new files mixed until the update finishes. Updates run
only in consolidation and `apply_proposal`, and `SKILL.md` is written last, so this is accepted.

### Listing and loading

- The `skills` section lists the visible active skills as name, description, and path
  `/skills/<scope>/<name>/SKILL.md`. It lists at most 50, in this order:
  1. agent skills;
  2. shared skills, by this agent's uses;
  3. shared skills, by all agents' uses.

  The list is stored and refreshed with the always-loaded memory, and the same stored list decides
  what `SkillsEnv` serves.

- The model loads a skill with the `read` tool from `@earendil-works/pi-durable/tools`. The
  conversation's `env` is [`SkillsEnv`](../packages/agents/src/memory/skills/env.ts), a read-only
  `ExecutionEnv` that resolves `/skills/<scope>/<name>/...` to the skill's R2 directory.
- Paths of skills the agent cannot see return not found. Writes, `exec`, and `watch` fail.
- Relative paths, and `..`, resolve within `/skills`. Scripts can be read but not run.
- The `afterTool` hook on `read` upserts `skill_usage` when a read of a `SKILL.md` succeeds.

### Lifecycle

All changes are operations of the memory agent during `consolidate` or `apply_proposal`, logged in
`memory_ledger`.

- **Create.** An agent skill comes from a procedure that succeeded at least twice in that agent's
  trajectories, with the trajectories and failure lessons as evidence. The memory agent writes it
  with `skill_write` during the agent scope's `consolidate` job. The write checks the structure:
  frontmatter `name` matching the skill, a 1–1024 character `description`, paths, and sizes. The
  skill is stored `active`. A skill that does not help goes stale unused.
- **Update an agent skill.** The memory agent overwrites it from new evidence of the same agent,
  passing the revision it read.
- **Promote.** When agent skills of two or more agents describe the same procedure, the memory
  agent proposes the merged skill to a shared space, preferring a space every source agent reads.
  When the proposal is applied:
  1. The memory agent writes `shared:<space>/<name>` and moves the `skill_usage` rows.
  2. For each source agent, it resolves the name with that agent's `sharedSpaces`. Only if the
     result is the new shared skill does it archive the source skill, with `absorbed_into`.
     Otherwise it keeps the agent skill and records why in the ledger.
- **Update a shared skill.** A shared skill changes only through an applied proposal backed by
  agent skills of two or more agents, such as their overrides of it.
- **Override.** A shared skill may keep failing for one agent while a different procedure
  succeeds. Then the memory agent writes an agent skill with the same name and `based_on` set to
  the shared skill and its content hash. It shadows the shared skill for that agent only. When
  several agents override a shared skill the same way, that becomes an update proposal.
- **Curate.** Pinned skills are exempt, and archived skills can be restored with
  `skill_archive`.

  | Skill        | `stale` after | `archived` after | Unused by |
  | ------------ | ------------- | ---------------- | --------- |
  | agent skill  | 14 days       | 30 days          | its agent |
  | shared skill | 30 days       | 60 days          | any agent |

  Days count from the last use or the last content write (`updated_at`). A status change other
  than a restore keeps `updated_at`.

## Shared memory

- Agents read the shared spaces listed in their `sharedSpaces` configuration: at most eight unique
  names of lowercase letters, digits, and hyphens. They are stored under `kodama:shared-spaces`
  beside the configuration Pi keeps
  ([`configuration/shared-spaces.ts`](../packages/agents/src/configuration/shared-spaces.ts)).
- The memory agent writes shared scopes only through [proposals](#proposals). During a
  `consolidate` job, it can propose a record (new, or replacing a shared record) or an agent skill
  of the job's scope.
- An agent record overrides a shared record through `memory_write`'s `overrides`.
- Applied proposals become new records; shared records are never rewritten in place.
- Content from untrusted sources is stored as an `event` with its source. One agent's
  conversation alone never reaches a shared space.
- Secrets are redacted before any write.

### Proposals

No person approves or reviews a change. Code checks each proposal when the memory agent writes it,
and the memory agent applies the accepted ones on its own
([`shared/`](../packages/agents/src/memory/shared/)).

- A proposal stores its target, the `base_revision` it was written against, and a payload of
  concrete operations: record contents, or skill files already uploaded as blobs. What is applied
  is exactly what was checked.
- The checks decide at once, and `decided_by` names the rule set (`checks:1`):
  - A record or skill that comes into a space needs active records or skills of at least two
    agents among its sources. Two agents are independent evidence that it is not one agent's
    quirk or one poisoned conversation.
  - Reorganizing a space (merging or replacing its records) needs sources that are all active
    records of that space.
  - `required` needs records of two agents, or sources that are already required.
  - Record text must not read as instructions to obey. Secrets are redacted before the proposal.
- A proposal that fails a check is stored `rejected` with the reason, and the tool tells the memory
  agent why. A proposal that passes is stored `accepted`.
- `accepted` means accepted and not yet applied, so the row itself is the durable pending work.
  Between jobs, the memory agent queues an `apply_proposal` job for every accepted row. A proposal
  written by the running job is therefore applied right after it, and a stop only delays the
  application.
- `apply_proposal` runs in code, with the proposal ID as `op_id`:
  - An `applied` row returns at once.
  - If the target's revision differs from `base_revision`, the row becomes `conflict` with a
    reason. The memory agent may write a new proposal against the current revision.
  - Otherwise, one `batch()` applies the payload and records the application: `applied` and
    `applied_at`, the ledger row, `scope_revisions`, and the `memory_ops` row.
- Every proposal, decision, and application is in the ledger, and a skill change can be rolled
  back from it.

## Settings

| Setting                            | Value                                       | Where                                 |
| ---------------------------------- | ------------------------------------------- | ------------------------------------- |
| memory agent model                 | `MEMORY_MODEL_PROVIDER` / `MEMORY_MODEL_ID` | `cloudflare.config.ts`                |
| `sharedSpaces`                     | `["global"]`, at most 8                     | agent configuration                   |
| idle delay before `extract`        | 10 minutes                                  | `src/agent/memory.ts`                 |
| always-loaded budget               | 2,200 characters (agent), 1,000 (shared)    | `working/always-loaded.ts`            |
| revision check before input        | every 60 seconds at most                    | `working/always-loaded.ts`            |
| `remember` calls per user entry    | 3                                           | `working/tools.ts`                    |
| `remember` content                 | at most 2,000 characters                    | `jobs.ts`                             |
| event half-life                    | 30 days                                     | `store/search.ts`                     |
| job retries                        | 1 minute, 10 minutes, 1 hour                | `memory-agent/memory-agent.ts`        |
| consolidation job size             | one scope, 200 records; 200 scopes a day    | `memory-agent/consolidation.ts`       |
| ledger and claim retention         | 90 days                                     | `memory-agent/consolidation.ts`       |
| settled job retention              | 30 days                                     | `memory-agent/consolidation.ts`       |
| pruning threshold / hard limit     | 1 GiB / 8 GiB                               | `prune/limits.ts`                     |
| entries per pruning run            | at most 16 MiB                              | `prune/limits.ts`                     |
| pruning retry after a failed check | 10 minutes                                  | `prune/limits.ts`                     |
| archive chunk / tool result text   | 2,000 / 2,000 characters                    | `archive/segment.ts`, `transcript.ts` |
| `history_search` index read        | 4 MiB per call, 5 matches                   | `archive/history.ts`                  |
| skill files                        | 32 files, 256 KiB each                      | `skills/paths.ts`                     |
| skills listed per agent            | 50                                          | `skills/usage.ts`                     |
| agent skill stale / archive        | 14 / 30 days                                | `skills/curation.ts`                  |
| shared skill stale / archive       | 30 / 60 days                                | `skills/curation.ts`                  |
| unreferenced skill blob grace      | 1 day                                       | `skills/curation.ts`                  |
| agents needed for a shared change  | 2                                           | `shared/proposals.ts`                 |

## Testing

Memory is tested in workerd with a mocked model, like the rest of the agent (see
[agents.md](agents.md#testing)). Each test sits next to the module it tests; shared
setup lives in `src/helper/memory.ts` and `src/helper/skills.ts`. Paths below are relative to
`src/memory/` unless they start with `src/`.

| Test file                            | Covers                                                               |
| ------------------------------------ | -------------------------------------------------------------------- |
| `store/records.test.ts`              | operations: replays, conflicts, freshness, revision claims; search   |
| `memory-agent/memory-agent.test.ts`  | jobs, retries, `remember`, consolidation                             |
| `src/agent/memory.test.ts`           | extraction, the always-loaded copy, revision checks                  |
| `src/agent/alarms.test.ts`           | purposes coexist in one alarm                                        |
| `prune/prune.test.ts`                | pruning states, stops at each step, delete checks, the hard limit    |
| `archive/history.test.ts`            | the `record_archive` summary of a segment, found by `history_search` |
| `skills/write.test.ts`               | skill writes, recovery of a stopped write, rollback                  |
| `skills/skills.test.ts`              | listing, shadowing, `SkillsEnv`, usage, curation                     |
| `shared/spaces.test.ts`              | shared spaces, overrides, required records                           |
| `shared/proposals.test.ts`           | proposal checks, application, conflicts, promotion                   |
| `src/lib/redact.test.ts`             | secret redaction and the injection check                             |
| `evaluation.test.ts`                 | probes after compaction, pruning, and eviction                       |
| `src/agent/harness.test.ts`          | rows written per streamed turn stay under a recorded budget          |
| `src/storage/pi-assumptions.test.ts` | behavior of Pi Durable and D1 that this design relies on             |
| `drizzle/schema.test.ts`             | the schemas match their generated migrations                         |

### Evaluation

`src/memory/evaluation.test.ts` runs probe questions with a scripted model, after pruning and eviction.
It checks the following:

- the decision is in the always-loaded memory, and the early turns are in the summary;
- `history_search` finds a word that only the pruned entries hold;
- a superseded decision leaves the newest memory section;
- an unknown topic finds nothing;
- a `before` bound older than the archive finds nothing;
- a retried request ID from the pruned range returns its first submission.

With a scripted model, these probes check what reaches the context, not how well a model uses it.

### Pi Durable assumptions

The design relies on this behavior of Pi Durable 1.2.0 and D1. `src/storage/pi-assumptions.test.ts`
pins
the first three:

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

The Pi session stays in the Durable Object. Long-term memory goes to D1, and raw entries and skill
files go to R2. Per row and per GB, a Durable Object is not more expensive than D1, so cost is not
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
each scope one writer, and it can use its own model. The memory agent is an `Agent` subclass with
its own binding, so public RPC cannot reach it, its tools live in a separate registry, and its work
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
- unrequested saves start with lower importance and may be declined.

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
- unused skills go stale and are then archived.

Skills are loaded the way Pi loads them: the section lists them, and the model reads them with
`read`. Bundled files therefore keep working by relative path.

### Shared memory needs a second agent, not a person

Agents run unattended for months, so a person in the loop would leave proposals waiting and shared
memory stale. A second agent's independent record is the confirmation instead: one poisoned
conversation or one agent's quirk cannot reach every agent on its own.

Checking `base_revision` at application turns an outdated proposal into a `conflict` instead of
undoing a newer change.

## Known limits

- Whether `databaseSize` falls after pruning in production is not verified. Locally, it fell from
  20.5 MB to 5.1 MB.
- `submissions` are never pruned; one row per input stays for the life of the agent.
- About 111 rows are written for a one-second, 40-delta stream at a 100 ms progress interval, and
  about 66 at 1 s (`src/agent/harness.test.ts`). Production numbers may differ.
- 「プラクティス」 alone does not match 「ベストプラクティス」.
- `history_search` has no ranking across all ranges, and finding something old can take several
  calls with `before`.
- D1 is one database for all agents. Consolidation records its size, but when to split it is not
  decided.
- The shared-skill windows, the two agents needed for a shared change, and the 50-skill limit are
  kodama's choices, not measured values.

## Open questions

- How long must archived entries be kept, and who may delete them?
- Who may roll back a skill change, and through which RPC?
- Which model should the memory agent use?
- How coarse may live streaming to the UI become in exchange for fewer writes?
