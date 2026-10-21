# Long-term memory

Status: proposal. Nothing in this document is implemented yet.
A Japanese version is in [long-term-memory.ja.md](long-term-memory.ja.md).
The reasons for each decision are in [Rationale](#rationale).

Kodama agents run for weeks or months in one conversation. This design keeps what matters in
long-term memory outside the agent's Durable Object, keeps the Pi session in the object, and
prunes the session's old rows so storage stays bounded.

## Components

| Store                        | Binding        | Contents                                                                                  |
| ---------------------------- | -------------- | ----------------------------------------------------------------------------------------- |
| Agent Durable Object         | `AGENTS`       | Pi Durable session; always-loaded copy and skill list; pruning state; alarm schedule      |
| `MemoryAgent` Durable Object | `MEMORY_AGENT` | the memory agent (one instance, `memory`) and its job queue                               |
| D1 database                  | `MEMORY_DB`    | memory records, applied operations, revisions, archive catalog, skills, proposals, ledger |
| R2 bucket                    | `ARCHIVE`      | archived entries and their search indexes (`archive/`), skills (`skills/`)                |

```text
AgentService (public RPC entrypoint)
  `-- AGENTS ---------------------> Agent DO (agentId)   MemoryAgent is not reachable from here

Agent DO (agentId)
  |-- reads ----------------------> D1 MEMORY_DB         memory_search, archive catalog, revisions
  |-- writes ---------------------> D1 MEMORY_DB         usage counters, archive catalog (pruning)
  |-- read (SkillsEnv) -----------> R2 ARCHIVE           SKILL.md and bundled files
  |-- reads and writes -----------> R2 ARCHIVE           archived entries and indexes, history_search
  `-- MEMORY_AGENT.enqueue -------> MemoryAgent DO       remember, extract, record_archive

MemoryAgent DO ("memory")
  |-- reads and writes -----------> D1 MEMORY_DB
  |-- reads and writes -----------> R2 ARCHIVE           archived entries, skill blobs
  |-- AGENTS readEntries ---------> Agent DO             paged entries for extraction
  |-- AGENTS memoryJobSettled ----> Agent DO             job outcome; a hint, not the record
  `-- AGENTS memoryChanged -------> Agent DO             refresh hint; revisions are the record

scheduled handler --------------> MemoryAgent DO       consolidate (daily)
```

Only the memory agent changes memory records and skills. Working agents write usage counters and,
while pruning, the archive catalog of their own entries.

## Memory model

### Scopes

| Scope                                          | Contents                                       | Writer                                  |
| ---------------------------------------------- | ---------------------------------------------- | --------------------------------------- |
| `agent:<agentId>`                              | the agent's notes, conventions, events, skills | memory agent                            |
| `shared:<space>` (for example `shared:global`) | team conventions, shared facts, shared skills  | memory agent, through checked proposals |

There is no per-person scope. `sharedSpaces` (a new `AgentConfig` field, default `["global"]`,
validated like `tools`) lists the shared spaces an agent reads.

An agent record may set `overrides` to the ID of a shared record. For that agent, the agent record
replaces the shared one, unless the shared record has `required = 1` (a team rule): then the agent
record is not loaded, and consolidation marks it `invalid` with a ledger row. Other agents keep the
shared record.

### Kinds

| Kind          | Lifetime                                                                   |
| ------------- | -------------------------------------------------------------------------- |
| `fact`        | no decay; replaced only by a newer record that supersedes it by ID         |
| `instruction` | as `fact`; multi-step instructions become skill candidates                 |
| `event`       | ranked by recency (half-life 30 days); archived after the retention window |
| `task`        | dropped when done                                                          |

`origin` is one of `user_request`, `agent_judgment`, `extraction`, `consolidation`, or
`proposal`. Summaries of archived entries are not memory records; they live next to the archived
entries in R2.
Hard deletion is an operator action.

### D1 schema

The schema is defined with Drizzle in
[schema.ts](../../packages/agents/src/memory/schema.ts). `pnpm db:generate` writes the D1
migrations to `packages/agents/drizzle/d1`, applied with `cf d1 migrations apply --dir drizzle/d1`.
The migrations of kodama's tables in each Durable Object go to `drizzle/durable-object`; everything
under `drizzle/` is drizzle-kit output and is never edited by hand. No SQL is written by
hand: queries use Drizzle's query builder, and migrations come only from `drizzle-kit generate`.
drizzle-kit 0.31 does not inline the values of check constraints, so allowed values are enforced
by the typed columns and the code that writes them; the constraints are keys and relations between
columns.

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
| `shared_proposals`       | proposals for shared memory, their decisions and application                      |
| `memory_ledger`          | append-only log of every change, including declined items                         |

### Applying a write

Every change the memory agent makes is an operation with an `op_id`. For a tool call it is the
SHA-256 of the job ID and Pi's tool call ID, so running a recorded tool call again yields the same
`op_id`. For code jobs it is the job ID and the step.

1. Look up `memory_ops` by `op_id`. If a row exists, return its `result_json` and change nothing.
2. Read the targets and check the operation's expectations, for example that the record to
   supersede is `active` at the revision the operation names. If not, return `conflict` without
   writing; the candidate is logged and evaluated again later.
3. Send one `batch()`: the `memory_ops` row, guarded updates (`WHERE id = ? AND status =
   'active' AND revision = ?`) that set the next revision, a `revision_claims` row for each
   next revision, plain `INSERT` of new records and their `memory_terms`, the ledger row, and a
   new `scope_revisions` value.

Writes never use `INSERT OR IGNORE`. A duplicate record ID or a replayed `op_id` fails a
statement, and `batch()` rolls the whole operation back. Every change of a revision claims the
next one in `revision_claims`, whose primary key is the target and the revision: a second writer
that read the same revision fails on that key, so its update, which matched no row, rolls back
with the rest of its batch. Step 2 already rejects a revision the target has not reached. The memory agent runs one job at a time (see [Jobs](#jobs)), so the read in step 2 stays valid until step 3;
the constraints are the backstop. Working agents update only `use_count` and `last_used_at`,
which do not change `revision`.

Other rules:

- Superseding names the old record: `memory_supersede(oldId, oldRevision, content)`. Before
  writing, the memory agent finds candidates with `memory_search`; there is no topic key. The new
  record has the old record's scope. Changing a record of another scope goes through `overrides`
  or a shared proposal.
- Record ID: SHA-256 of scope, kind, content, source agent, and first source entry.
- `superseded_by` is not a foreign key, because D1 checks foreign keys immediately and the old
  row is updated before the new row exists.
- Entry IDs are never reused, so checkpoints and archive ranges are keyed by agent and entry ID
  only.

### Freshness

The order in which jobs run is not the order of the information. A candidate may supersede or
invalidate a record of the same source agent only if its `source_entry_to` is greater than the
record's. Otherwise `memory_supersede` returns `stale` and the candidate is declined in the ledger,
so extracting an old range never undoes a newer `remember`.

Entry IDs of different agents cannot be compared. A candidate never supersedes another agent's
record or a shared record directly: it becomes a shared proposal with `base_revision`, and a
contradiction the memory agent cannot settle stays as `conflict` in the ledger, and it may propose
again against the current revision.

### Search text

`memory_terms` holds each distinct normalized word of a record, written in the batch that writes
the record. One shared function produces the words for records, archive indexes, and queries:

1. NFKC-normalize and lowercase.
2. Segment with `new Intl.Segmenter('ja', { granularity: 'word' })`; keep `isWordLike`
   segments.
3. In each segment, remove `ー` after katakana (`/([ァ-ヴ])ー+/g` → `$1`).
4. Merge adjacent katakana segments into one word.
5. For stored text only: append the original segments that differ from the merged words.

A record matches a query when it has every merged word. If nothing matches, retry with the
original segments, then with each merged word as a prefix (the range of terms from the word up to
the word followed by U+10FFFF, so the primary key serves it). `search_version` stores the version
of this function; consolidation rebuilds the terms of records with an older version.

### Queries

- Always-loaded memory: active `instruction` and `fact` records of the agent's scope and its
  shared spaces, resolved by the precedence above, ordered by `pinned`, `importance`,
  `last_used_at`, and cut to a character budget in code.
- `memory_search`: for each word, the active records of the allowed scopes that have it, joined
  from `memory_terms`; the records that have every word are ranked by importance, use, and for
  events recency. The returned rows get `use_count` one higher and `last_used_at` in one batch; a
  use counted twice at the same moment may be lost.
- `history_search`: see [Archive index](#archive-index).

## Memory agent

- `class MemoryAgent extends Agent`, exported as its own Durable Object class, one instance
  named `memory`. It inherits `Agent` as it is, including `subscribe`, `snapshot`, and
  `submission`, so a UI can later watch its jobs through an authenticated `AgentService` method.
- Not part of `AgentService` for now. Jobs come only from working agents, pruning, its own
  accepted proposals, and the `scheduled` handler.
- `sendMessage`, `send`, and `sendTo` throw, because jobs enter only through `enqueue`; input
  that bypasses the queue would break one job at a time. `cancel` stops the running job, which the
  runner retries like a failure.
- Fixed configuration built in code: model from `MEMORY_MODEL_PROVIDER` and `MEMORY_MODEL_ID`,
  the memory-keeping system prompt. `setConfig` throws.
- `Agent` gains protected factories for its harness options and default configuration, which
  `MemoryAgent` overrides to supply its registry and fixed configuration.
- Its own registry holds the tools `memory_search`, `memory_write`, `memory_supersede`,
  `memory_decline`,
  `read_entries`, `skill_write`, `skill_archive`, `shared_propose`, and `notify_memory_changed`.
  Each writing tool applies its change as an operation (see
  [Applying a write](#applying-a-write)). `skill_write` accepts only agent scopes. The working
  agents' registry does not contain these tools.
- Its own Pi session is pruned like any agent's, without extraction or archiving.

### Jobs

`enqueue(job)` validates the job with valibot and inserts it into `memory_jobs`, a table in the
memory agent's own SQLite outside Pi's tables:

| Column                        | Meaning                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `job_id`                      | primary key: hash of source agent, source entry, and content; or proposal ID |
| `kind`, `priority`, `payload` | the job                                                                      |
| `status`                      | `queued`, `running`, or `settled`                                            |
| `outcome`                     | `persisted`, `declined`, `conflict`, or `failed` once settled                |
| `attempts`, `not_before`      | retry state                                                                  |
| `submission_id`               | the Pi submission of a model job                                             |

A repeated `enqueue` finds the existing row and returns it. `jobStatus(jobId)` reads a row.

Kinds: model jobs `remember`, `extract`, `record_archive` (summarize an archived segment), and
`consolidate`; the code job `apply_proposal`.

One runner, serialized like `RecoveryAlarm`, keeps at most one job in progress:

1. Take the queued job with the highest priority, then the oldest, whose `not_before` has passed,
   and mark it `running`.
2. For a model job, the conversation is idle with an empty inbox: call `reset()`, which Pi places
   at once while idle, then `submit()` the job as input with the job ID as `requestId`. Each job
   starts in a fresh context. Record `submission_id`. A code job runs in code without Pi.
3. When the submission settles, derive the outcome from the job's `memory_ops` and ledger rows,
   mark the job `settled`, and call `memoryJobSettled(jobId, outcome)` on the source agent.
4. Only then take the next job.

On start and on its alarm, the runner resumes a `running` job: it waits for its submission, or
submits it again with the same `requestId` if none was recorded (Pi returns the existing
submission).

- Priority: `remember` first, then `apply_proposal` and `record_archive`, then `extract`, then
  `consolidate`.
- Consolidation is split into bounded jobs (one scope and at most 200 records each), so a
  `remember` waits for at most one bounded job.
- A failed job is retried after 1 minute, 10 minutes, and 1 hour, then settles `failed` with a
  ledger row.

## Working agents

Tools: `memory_search`, `history_search`, `remember`, and Pi Durable's `read` tool for skills.

`remember` is called in the turn when:

- the user asks to remember something or gives a standing instruction ("always", "from now on");
- the agent judges something worth keeping: a decision and its reason, a correction from the
  user, a lesson from a failure, or a durable fact it had to look up.

`remember` returns `accepted` with the job ID once the job is enqueued; it does not wait for the
memory model. The job later settles as `persisted`, `declined`, or `failed`, reported by
`memoryJobSettled` and readable with `jobStatus`.

The system prompt lists what not to keep: task state, tentative conclusions, secrets, one-off
requests, and anything the repository or its docs already cover. At most three `remember` calls
are accepted per turn.

## Write paths

### Remember

1. Validate the input with valibot, cap its size, and reject injection patterns.
2. Enqueue a `remember` job carrying the content, its origin (`user_request` or
   `agent_judgment`), and the source entry IDs. Return `accepted`.
3. The memory agent classifies it, reconciles it with existing records, and writes it:
   - `user_request`: written as asked; it supersedes an earlier record with the same key.
   - `agent_judgment`: may be declined as a duplicate or low value (logged in the ledger);
     starts with lower importance; archived by consolidation if never used.
4. The job settles and the working agent receives `memoryJobSettled`.

### Extract

Enqueued by the working agent when it has been idle for a while (its `extract` alarm) and when
pruning finds the checkpoint behind.

1. `read_entries` pages through entries after the checkpoint: from the agent DO
   (`scanEntries`), or from the R2 segment for a range already pruned.
2. Extract candidate records.
3. Drop candidates that the cited entries do not support.
4. Add, supersede, invalidate, or skip against existing records, subject to
   [Freshness](#freshness).
5. The last operation of each page also advances the checkpoint (guarded by its `revision`) and
   sets `extracted = 1` on segments the page completes.

### Consolidate

Sent once a day by the `scheduled` handler as bounded jobs. Merge duplicates, resolve
contradictions, decay events, adjust importance and pinning so the always-loaded memory fits its
budget, re-segment rows with an old `search_version`, propose skills, prepare shared proposals,
apply any `accepted` proposal left unapplied, and delete in small batches: archived events, old
ledger rows, and skill blobs referenced by no retained ledger row or pending skill write and older
than one day. Record the database size (`meta.size_after`) and the record count per
scope in the ledger.

The cron trigger (`17 3 * * *`, UTC) calls `MemoryAgent.consolidate()`. In code it deletes
settled jobs older than 30 days and ledger rows older than 90 days, re-segments rows with an old
`search_version`, enqueues one `consolidate` job per scope changed in the last day (at most 200
scopes), and logs the sizes. The job reads the scope's active records with `list_records` (at
most 200, by kind and then most used) and changes them with `memory_supersede` and
`memory_invalidate`.

## Always-loaded memory

A Pi prompt section renders two capped blocks from the always-loaded query: the agent's memory
and a small shared block, each with its budget shown (`[67% — 1,474/2,200 chars]`). The agent
DO stores the rendered text and the `scope_revisions` it was built from in a Pi document.
Requests read the stored copy.

The copy is refreshed while the agent is idle:

- when the object starts;
- when `memoryChanged` arrives;
- before admitting input, if the last revision check is older than 60 seconds: one query reads
  `scope_revisions` for the agent's scope and shared spaces, and any newer revision re-renders
  the copy first.

A lost notice therefore delays an update until the next turn at most 60 seconds later. No change
needs to wake every agent.

## Compaction

Pi's built-in compaction with its defaults. Kodama does not hook or replace it.

## Alarms

A Durable Object has one alarm. `AlarmSchedule` stores a due time per purpose in the object's
storage (`recovery`, `extract`, and `prune` in the agent; `jobs` in the memory agent) and sets the
alarm to the earliest. `alarm()` runs every due purpose and sets the alarm again. `RecoveryAlarm`
becomes the `recovery` purpose: when no task is runnable it clears only its own time.

## Pruning

The agent DO archives and deletes old rows of its Pi session.

Prunable rows, where `P` is the `head` of the newest head marker in the root conversation:

- `entries` of the root conversation with `id < P`;
- `tasks` with `status = 'terminal'`, with their task-scoped `documents` and
  `document_revisions`;
- the matching `record_ids` rows.

`submissions` are kept. Pi stores no time on them, and `submissionByRequest` uses them to answer a
retried request with its first result; one row per input is small next to the entries.

When the agent goes idle, it schedules the `prune` alarm if a run is unfinished, or if
`ctx.storage.sql.databaseSize` is above the threshold (1 GB by default) and entries before `P`
remain. The check reads storage only, so it also runs while the harness opens. An operator can
lower the limits of one object with the `kodama:prune-limits` key. A run covers at most 16 MB of entries, so that building its files
fits the object's memory and CPU limits; runs repeat until the size is below the threshold. Its
state is a `prune_runs` table in the agent's SQLite, outside Pi's tables, with one unfinished run at
a time:

| State      | What is confirmed                                             |
| ---------- | ------------------------------------------------------------- |
| `prepared` | the range from the last pruned entry, up to `P - 1`, is fixed |
| `exported` | the entries, manifest, and index are in R2 and verified       |
| `indexed`  | the `archive_segments` row is in D1                           |
| `deleted`  | the rows are gone from the Durable Object                     |

On start and on the `prune` alarm, an unfinished run continues from its state.

1. **Prepare.** Fix the range and record `prepared`. If the extraction checkpoint is below
   `P - 1`, enqueue an `extract` job; pruning does not wait for it, because extraction can read
   the segment from R2 later.
2. **Export.** Under `archive/<agentId>/<first>-<last>`, write the entries (`.jsonl`), the
   manifest (`.manifest.json`: range, count, times, SHA-256, Pi Durable version), and the search
   index built in code (`.index.json`, see [Archive index](#archive-index)). Read them back to
   verify, and record `exported`. The keys depend only on the range, so a repeated export
   overwrites the same objects.
3. **Catalog.** Insert the `archive_segments` row, read it back, and record `indexed`. Then
   enqueue `record_archive` for the summary.
4. **Delete.** Inside `blockConcurrencyWhile`, which here does only local SQLite work and stays
   far below its 30-second limit, check again:
   - `harness.inspect()` reports no live task, background compaction included, because a
     background compaction rereads entries from its recorded `tail` when it resumes;
   - the root is the only conversation;
   - no input or write submission is queued;
   - the newest head marker's `head` is still `P` or later.

   If any check fails, keep the run `indexed` and set the `prune` alarm 10 minutes later.
   Otherwise close the harness, delete the prunable rows and record `deleted` in one
   `transactionSync`, then reopen the harness and refresh the alarms. The deleted entries are
   those of the run's range; the last `deleted` run's last entry is the pruned boundary. Requests
   that arrive meanwhile wait for the reopened harness.

Steps 1–3 run while the agent keeps working; only step 4 needs it to be idle.

Above the hard threshold (8 GB), `sendMessage` rejects new input with a retryable
`storage_maintenance` error until a run reaches `deleted`, so a busy agent drains and pruning gets
its idle moment. Pruning needs only R2 and D1, so a stopped memory agent delays extraction and
summaries, not reclaiming storage.

`readEntries` reads a range below the pruned boundary from its archived segment, so an extraction
that fell behind still sees every entry.

The memory agent prunes its own session the same way, without an archive: its entries are the
scratch work of finished jobs, and its records are already in D1. It checks between jobs, at the
end of each drain, because closing the harness mid-job would fail the job.

Pruning writes to Pi's internal tables. Pin the Pi Durable version, keep pruning in one module,
and run the pruning tests on every Pi upgrade.

### Archive index

Each archived range has its search index in R2, next to its entries:

- `.index.json` is written by the pruning code. It splits the text of user and assistant
  messages, tool names and arguments, and the first 2,000 characters of each tool result into
  chunks of about 2,000 characters. For each chunk it stores the entry range and the byte range in
  the `.jsonl` object; for each normalized word (from the search-text function) it lists the
  chunks that contain it. It records the `search_version` it was built with.
- `.summary.json` is written by the `record_archive` job: the summary and its normalized words.
  Writing it sets `has_summary` on the catalog row.
- The `archive_segments` row in D1 is the catalog: range, times, size, SHA-256, and whether
  extraction and the summary are done. It is small, one row per range.
- The objects and the row are deleted only together, by the operator's retention action.
  Consolidation never expires them.

`history_search(query, before?)`:

1. List this agent's catalog rows newest first, starting before `before` if given.
2. Read their `.summary.json` and `.index.json` objects in that order until 4 MB have been read.
3. A chunk matches when it contains every query word: the merged words first, then the original
   segments, then each merged word as a prefix, as in [Queries](#queries). A summary matches the
   same way. Matches are returned newest first, at most five.
4. Read the matched byte ranges from the `.jsonl` objects and return them with their entry IDs
   and times, plus the oldest time searched. The model passes that time as `before` to search
   further back.

## Skills

Skills follow the Agent Skills format: a directory with `SKILL.md` (`name`, `description`) and
optional `references/`, `assets/`, and `scripts/`.

### Scopes and visibility

| Scope             | Visible to                                    | Changed by                                     |
| ----------------- | --------------------------------------------- | ---------------------------------------------- |
| `agent:<agentId>` | that agent                                    | memory agent                                   |
| `shared:<space>`  | agents whose `sharedSpaces` include `<space>` | memory agent, only through an applied proposal |

An agent skill shadows a shared skill with the same name. Between shared spaces, the earlier
space in `sharedSpaces` wins. Each name appears once in the listing.

### Storage

- Each skill is one R2 directory, `skills/<scope>/<name>/`, overwritten in place on update. The
  `skills` row holds `content_sha256` (over each path and its file's SHA-256) and `revision`.
- An update is one operation, recorded before any file changes so that a stop can be finished:
  1. upload the new files to `skills/.blobs/<sha256>`, and copy there each file that will be
     overwritten or removed (content-addressed, so a file is stored once);
  2. insert a `pending` `skill_writes` row with the `op_id` and each changed path's before and
     after SHA-256;
  3. overwrite and remove the files in the skill directory, supporting files first and `SKILL.md`
     last;
  4. in one `batch()`, update `content_sha256` (`WHERE revision = ?`), write the ledger row with
     the per-file hashes, the `scope_revisions` increment, and the `memory_ops` row, and mark the
     `skill_writes` row `done`.
- On start and before each job, the memory agent finishes every `pending` `skill_writes` row: it
  copies the after blobs into the directory again and runs step 4. Step 3 writes the same bytes
  each time, so a stop at any point ends in the new version.
- A rollback is an operation that writes a ledger row's before blobs back in the same way.
- `skill_usage` counts uses per skill and agent. Working agents upsert it.
- Skill directories and blobs live in the `ARCHIVE` bucket. A skill has at most 32 files of at most
  256 KB each, and paths are `SKILL.md` or below `references/`, `assets/`, or `scripts/`.

### Listing and loading

- A `skills` extension adds a `skills` section with the visible active skills as name,
  description, and path `/skills/<scope>/<name>/SKILL.md`: agent skills first, then shared
  skills by this agent's uses, then by all agents' uses, at most 50. The list is stored and
  refreshed with the always-loaded memory, and the same stored list decides what `SkillsEnv`
  serves.
- The model loads a skill with the `read` tool from `@earendil-works/pi-durable/tools`. The
  conversation's `env` is `SkillsEnv`, a read-only `ExecutionEnv` that resolves
  `/skills/<scope>/<name>/...` to the skill's R2 directory.
- Paths of skills the agent cannot see return not found. Writes, `exec`, and `watch` return
  `not_supported`. Relative paths resolve against `/skills`. Scripts can be read but not
  run.
- An `afterTool` hook on `read` upserts `skill_usage` when the path ends in `SKILL.md`.

### Lifecycle

All changes are operations of the memory agent during `consolidate` or `apply_proposal`, logged
in `memory_ledger`.

- **Create.** An agent skill, from a procedure that succeeded at least twice in that agent's
  trajectories, with the trajectories and failure lessons as evidence. The memory agent writes it
  with `skill_write` during the agent scope's `consolidate` job; the write checks the structure
  (frontmatter `name` matching the skill and a 1–1024 character `description`, paths, sizes) and
  stores the skill `active`. There is no replay; a skill that does not help goes stale unused. The
  job also has `list_skills`, `read_skill`, and `skill_archive` (archive or restore).
- **Update an agent skill.** Overwritten from new evidence of the same agent, after a check.
- **Promote.** When agent skills of two or more agents describe the same procedure, the memory
  agent uploads the merged skill and writes one `shared_proposals` row
  (target `skill`) that lists the sources, preferring a space every source agent reads. When it is
  applied, the memory agent writes `shared:<space>/<name>` and moves `skill_usage` rows. For each
  source agent it then resolves the name with that agent's `sharedSpaces`: only if the result is
  the new shared skill does it archive the source with `absorbed_into`. Otherwise it keeps the
  agent skill and records why in the ledger.
- **Update a shared skill.** Only through a proposal backed by agent skills of two or more agents,
  such as their overrides of it, accepted by the checks and applied.
- **Override.** When a shared skill keeps failing for one agent while a different procedure
  succeeds, the memory agent writes an agent skill with the same name and `based_on` set to the
  shared skill and its content hash. It shadows the shared skill for that agent only. When
  several agents override a shared skill the same way, that becomes an update proposal for the
  shared skill.
- **Curate.** An agent skill becomes `stale` after 14 days without use by its agent and
  `archived` after 30. A shared skill becomes `stale` after 30 days without use by any agent and
  `archived` after 60. Pinned skills are exempt. Archived skills can be restored. Days count from
  the last use or the last content write (`updated_at`); a status change other than a restore
  keeps `updated_at`.

### Proposals

No person approves or reviews a change. Code checks each proposal when the memory agent writes it,
and the memory agent applies the accepted ones on its own.

- A proposal stores its `target_key`, the `base_revision` it was written against, and a payload
  of concrete operations: record contents, or skill files already uploaded as blobs. What is
  applied is exactly what was checked.
- The checks decide at once, with `decided_by` naming the rule set (`checks:1`):
  - a record or skill that comes into a space needs active records or skills of at least two
    agents among its sources, as independent evidence that it is not one agent's quirk or one
    poisoned conversation;
  - reorganizing a space (merging or replacing its records) needs sources that are all active
    records of that space;
  - `required` needs records of two agents, or sources that are already required;
  - record text must not read as instructions to obey; secrets are redacted before the proposal.
    A proposal that fails is stored `rejected` with the reason, and the tool tells the memory agent
    why. A proposal that passes is stored `accepted`.
- `accepted` means accepted and not yet applied, so the row itself is the durable pending work.
  Between jobs the memory agent queues `apply_proposal` for every accepted row, so a proposal
  written by the running job is applied right after it, and a stop only delays the application.
- `apply_proposal` runs in code, with the proposal ID as `op_id`. An `applied` row returns at
  once. If the target's revision differs from `base_revision`, the row becomes `conflict` with a
  reason, and the memory agent may write a new proposal against the current revision. Otherwise
  one `batch()` applies the payload and sets `applied`, `applied_at`, the ledger row,
  `scope_revisions`, and the `memory_ops` row.
- Every proposal, decision, and application is in the ledger, and a skill change can be rolled
  back from it.

## Shared memory

- The memory agent creates a `shared_proposals` row from agent-scope records that more than one
  agent relies on, and code accepts or rejects it at once (see [Proposals](#proposals)).
- Agents read the shared spaces listed in their `sharedSpaces`: at most eight unique names of
  lowercase letters, digits, and hyphens, stored in the agent's storage under
  `kodama:shared-spaces` beside the configuration Pi keeps. `setConfig` refreshes the
  always-loaded memory and the skills list when it stores them.
- The memory agent proposes with `shared_propose` during a `consolidate` job: a record, new or
  replacing a shared record, or an agent skill of the job's scope, whose files it stores as blobs
  so what is applied is what was checked. A `consolidate` job of a shared scope changes nothing
  directly; it can only propose.
- An agent record overrides a shared record with `memory_write`'s `overrides`. Consolidation
  invalidates an agent record that overrides a `required` shared record.
- Applied proposals become new records; shared records are never rewritten in place.
- Content from untrusted sources is stored as an `event` with its source; one agent's
  conversation alone never reaches a shared space.
- Secrets are redacted before any write.

## Configuration

| Setting                            | Default                                  |
| ---------------------------------- | ---------------------------------------- |
| `progress.partialIntervalMs`       | 100 ms (to be raised after measurement)  |
| `MEMORY_MODEL_PROVIDER` / `_ID`    | none                                     |
| idle delay before `extract`        | to be set                                |
| always-loaded budget               | 2,200 characters (agent), 1,000 (shared) |
| revision check before input        | every 60 seconds at most                 |
| pruning threshold                  | 1 GB                                     |
| hard threshold (input rejected)    | 8 GB                                     |
| pruning retry after a failed check | 10 minutes                               |
| archive chunk / tool result index  | 2,000 / 2,000 characters                 |
| `history_search` index read        | 4 MB per call                            |
| entries per pruning run            | at most 16 MB                            |
| job retries                        | 1 minute, 10 minutes, 1 hour             |
| consolidation job size             | one scope, 200 records                   |
| unreferenced skill object grace    | 1 day                                    |
| event half-life                    | 30 days                                  |
| agent skill stale / archive        | 14 / 30 days                             |
| shared skill stale / archive       | 30 / 60 days                             |
| skills listed per agent            | 50                                       |
| agents needed to promote a skill   | 2                                        |
| `sharedSpaces`                     | `["global"]`                             |

## Phases

Each phase ships with workerd integration tests that mock the model. Failure tests stop a step by
throwing from an injected hook and then reopen the object.

1. **Measurement.** Set the progress interval explicitly; record rows written, database size,
   and context size per turn.
   Tests: rows per turn stay under a recorded budget.
2. **D1 memory and the memory agent.** Migration, search-text function, operations,
   `MemoryAgent` with its job runner, `remember`, `extract` with checkpoint, `memory_search`,
   always-loaded section with revisions, `AlarmSchedule`.
   Tests:
   - `remember` returns `accepted` in the same turn and the job settles `persisted`;
   - a repeated tool call creates no second job;
   - an agent-judged duplicate is declined;
   - working agents have no memory-writing tools and `AgentService` cannot reach the memory
     agent;
   - applying the same supersede twice leaves one active record with unchanged content;
   - a stale `base` revision returns `conflict` and changes nothing;
   - a job B enqueued while job A runs is not reset by A's completion and does not see A's
     context;
   - extracting an old range after a newer correction does not undo the correction;
   - with `memoryChanged` dropped, the always-loaded copy updates before the next turn after the
     revision check interval;
   - extraction, recovery, and pruning alarms coexist: clearing the recovery time keeps the
     others;
   - a fact stated before several compactions is found afterwards;
   - a resumed extraction writes no duplicates;
   - a failed extraction keeps the checkpoint and does not affect the conversation;
   - Japanese queries such as 「使う」, 「リポ」, 「サーバレス」 find their records.
3. **Pruning.** R2 export, manifests, and indexes, `prune_runs`, the archive catalog, the pruning
   module,
   `record_archive`, `history_search`, the hard threshold.
   Tests:
   - after pruning the conversation continues, compacts again, survives eviction and alarm
     recovery, and cancels;
   - `snapshot()` is unchanged;
   - request IDs inside the retention window stay deduplicated;
   - with a background compaction live, no entries are deleted;
   - a stop after the R2 export and before indexing deletes nothing, and the run resumes;
   - a stop after indexing resumes and deletes once;
   - a word that appears only in the raw entries, not in the summary, finds them through
     `history_search`;
   - when the read budget stops a search, it returns the oldest time searched, and a search with
     that time as `before` continues further back;
   - with the memory agent stopped, pruning still reclaims storage and extraction later reads
     the segment from R2;
   - above the hard threshold new input is rejected as retryable;
   - `databaseSize` falls.
4. **Skills.** Blobs, `skill_writes`, `skills` extension, `SkillsEnv`, `skill_usage` hook,
   agent-skill lifecycle, curation.
   Tests:
   - the section lists visible active skills with paths, agent skills first;
   - an agent skill shadows a shared skill of the same name;
   - `read` returns `SKILL.md` and a bundled file by relative path;
   - a path of a skill the agent cannot see returns not found;
   - writes and `exec` through `SkillsEnv` fail;
   - a stop after each file write of an update is finished on restart: the skill ends in the new
     version, `content_sha256` matches its files, and the write is `done`;
   - rolling back one ledger row restores the before files;
   - reading `SKILL.md` upserts `skill_usage`;
   - `SkillsEnv` resolves relative paths and `..` within `/skills`. `registerEnvConformance()`
     has no read-only mode, so the tests check the read behavior directly.
5. **Shared memory and shared skills.** `sharedSpaces`, scope precedence, shared records,
   promotion and override of skills, proposal checks, `apply_proposal`.
   Tests:
   - an agent sees only the shared spaces in its `sharedSpaces`;
   - an agent record that overrides a shared record replaces it for that agent only;
   - a required shared record stays loaded and the agent record that overrides it does not;
   - two agents with the same procedure produce one promotion proposal;
   - applying it creates the shared skill, moves usage, and archives only sources whose name now
     resolves to it;
   - promoting skills of agents in different shared spaces leaves each agent with the procedure
     it chose before;
   - a record or skill of only one agent, a `required` record without two agents, and text that
     reads as instructions are rejected;
   - an accepted proposal is applied after the job that wrote it, exactly once;
   - a proposal whose base revision is outdated becomes `conflict` and does not undo the newer
     change;
   - a rejected proposal changes nothing;
   - a shared skill changes only through an applied proposal.
6. **Evaluation.** Probe questions after compaction and pruning: recall, files touched,
   continuation, decisions, knowledge updates, temporal questions, abstention.
   `test/evaluation.test.ts` runs them with a scripted model, after pruning and eviction: the
   decision is in the always-loaded memory and the early turns in the summary, `history_search`
   finds a word only the pruned entries hold, a superseded decision leaves the newest memory
   section, an unknown topic finds nothing, a `before` bound older than the archive finds
   nothing, and a retried request ID from the pruned range returns its first submission. With a
   scripted model they check what reaches the context, not how well a model uses it; files
   touched and continuation need a real model.

## Rationale

This part records, decision by decision, what the design takes from existing systems and papers
and what it rejects. Some reasons rest on outside evidence (an existing system or a paper); others
rest only on kodama's own constraints. The latter are marked "kodama constraint".

### Premises

- **Pi Durable never removes entries.** "A head on an entry changes subsequent context; it does not
  remove older entries from storage" (Pi Durable spec §2.1). Compaction and `reset()` only move the
  context head. Terminal tasks and section changes also stay, and Pi has no public API to prune
  them.
- **Context is already bounded.** Pi Durable compacts by default (`reserveTokens` 16384,
  `keepRecentTokens` 20000, `backgroundTokens` 32768). The summary uses a structured checkpoint
  format and carries the earlier summary forward (spec §8.7).
- **The hard limit is 10 GB per object.** At the limit, writes fail with `SQLITE_FULL`; reads and
  deletes still succeed (Durable Objects FAQ). The agent stops working.
- **Summaries cannot hold everything.** Each compression pass silently discards low-frequency
  details (summarization drift, 2603.07670). With a retrievable archive, recall stayed near 0.95
  at every compaction frequency; overwrite-only summaries reached 0.33–0.56 and got worse as
  compaction became more frequent (2607.08032, a small experiment).
- **One endless session is bad for learning.** Hermes Agent documents that a chat that is never
  reset runs for weeks as one session, grows expensive as compaction runs over an ever-longer
  history, and its learning loop almost never fires. A kodama agent that keeps one conversation is
  exactly this case.

### Existing systems

| System                                 | Always-loaded memory                                                   | Searchable memory                                       | Write trigger                                                                          | Old history                                                              | Skills                                                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| OpenClaw                               | `MEMORY.md`, `USER.md`                                                 | daily notes, hybrid BM25 + vector, recency decay        | agent writes; silent "memory flush" turn before compaction; daily "dreaming" promotion | transcript kept on disk; `session.maintenance` prunes after 30 days      | not checked                                                                                                                            |
| Hermes Agent                           | `MEMORY.md` (2,200 chars), `USER.md` (1,375 chars), frozen per session | `session_search` over SQLite FTS5                       | memory tool; background review after turns                                             | compaction starts a continuation session; `prune` deletes ended sessions | project, local, and external directories; higher precedence shadows the same name; edited in place, rolled back from a ledger; curator |
| Grok Build                             | per-project and global markdown topics                                 | topic files read on demand                              | background capture after every turn; `/dream` merges                                   | not documented                                                           | not documented                                                                                                                         |
| Cloudflare Agent Memory (private beta) | none                                                                   | facts, events, instructions, tasks; FTS + vectors + RRF | bulk ingestion at compaction; `remember` and `forget` tools                            | raw messages kept; facts superseded, not deleted                         | not documented                                                                                                                         |
| Letta                                  | memory blocks                                                          | archival memory                                         | memory tools; sleep-time agent                                                         | git-backed memory repositories, shareable across agents                  | not checked                                                                                                                            |
| Pi                                     | none                                                                   | none                                                    | none                                                                                   | entries never removed                                                    | global and project directories; the first discovered skill wins a name collision, with a warning                                       |

All of them keep procedures apart from facts as **skills**: name and description in the prompt,
body loaded when relevant (Anthropic's progressive disclosure). Claude Code: "If an entry is a
multi-step procedure … move it to a skill." Hermes: for something needed on every run of a
recurring task, a skill "is often the better home than a memory entry".

### 1. Long-term memory lives outside the agent's Durable Object, in D1 and R2

**Decision.** The Pi session stays in the Durable Object. Long-term memory goes to D1; raw entries
about to be pruned and skill files go to R2.

**Reasons.**

- The survey 2603.07670 recommends starting with working memory in the context and long-term
  records in an external store (Pattern B), and instrumenting it. OpenClaw and Hermes keep
  long-term memory in files separate from the transcript.
- The largest costs are write volume and active time, not stored bytes (estimate below). Per row
  and per GB, a Durable Object is not more expensive than D1. Memory moves out for three kodama
  constraints:
  - memory is shared between agents;
  - the UI and maintenance jobs read memory without waking agent objects;
  - the session's own rows are pruned over time.
- D1 has FTS5 and transactions through `batch()`. R2 stores large data at one fiftieth of D1's
  price per GB.

Prices are from the Cloudflare pricing pages (Workers Paid, October 2026). Allowances are per
account per month.

| Item                              | Price                                                  | Included     |
| --------------------------------- | ------------------------------------------------------ | ------------ |
| Durable Object duration           | $12.50 per million GB-s, billed on 128 MB while active | 400,000 GB-s |
| Durable Object or D1 rows written | $1.00 per million rows (deletes count)                 | 50 million   |
| Durable Object or D1 rows read    | $0.001 per million rows                                | 25 billion   |
| Durable Object SQLite storage     | $0.20 per GB-month                                     | 5 GB         |
| D1 storage                        | $0.75 per GB-month                                     | 5 GB         |
| R2 Standard storage               | $0.015 per GB-month                                    | none         |
| R2 writes / reads                 | $4.50 / $0.36 per million operations                   | none         |

One agent streaming model output 8 hours a day for 30 days, beyond the allowances:

| Cost source                                                                                                                        | Estimate                                             | Lever                            |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------- |
| Pi progress commits while streaming: at most one commit per 100 ms (`progress.partialIntervalMs`), about five rows each (measured) | about 43 million rows, about $43 (about $4.3 at 1 s) | raise the interval               |
| Duration while waiting on the model                                                                                                | 108,000 GB-s, $1.35                                  | unavoidable while the model runs |
| An open `subscribe()` stream all day (no hibernation)                                                                              | 324,000 GB-s, $4.05                                  | close streams nobody watches     |
| 1 GB of transcript kept in the object                                                                                              | $0.20 per month                                      | archive to R2 ($0.015)           |

**Rejected.**

- **Everything in Durable Objects** (a memory object per agent and per shared space). Cloudflare
  Agent Memory uses one Durable Object per memory profile, so the shape works. Shared memory would
  still need separate objects, and the UI or maintenance jobs would wake them to read.
- **Memory as markdown files in R2 only** (like OpenClaw and Hermes on disk). Cheapest storage and
  easy to edit by hand, but search needs a separate index and R2 has no transactions.
- **Cloudflare Agent Memory.** It matches this design closely and `cf` already has an
  `agentMemory` binding, but it is in private beta. The memory store stays behind an interface so
  it can be swapped in later.

### 2. Compaction is left to Pi

**Decision.** Pi's built-in compaction with its defaults, without hooks or replacement.

**Reasons.**

- Pi already selects the cut, summarizes in a structured format, carries the earlier summary
  forward, retries, and recovers from context overflow.
- The evidence for custom summarizers comes from other settings (ACE, 2510.04618, rewrites a
  playbook, not a conversation) or is vendor-measured (Factory's anchored iterative summarization).
- Owning the summary means owning its prompt, failures, and regressions for an unproven gain.
- The weakness of summaries (premise "Summaries cannot hold everything") is covered by keeping
  facts and the raw record outside the summary (decisions 3 and 6), not by a better summary.

**Rejected.**

- **Extract memories in `beforeCompact` and return an anchored summary.** It ties memory to Pi's
  compaction task and makes kodama responsible for summary quality without evidence that Pi's
  summary is the problem. It stays available if evaluation probes show losses that memory and
  `history_search` cannot cover.
- **Observation masking** (hide old tool output; 2508.21433 halves cost at equal performance). It is
  the same kind of optimization and waits until measurements show tool output dominating the
  context.

### 3. Raw entries are archived to R2 and pruned from the Durable Object

**Decision.** Entries that compaction has moved out of the context are written to R2 and verified,
indexed in R2 and cataloged in D1 by code, and then deleted from the Durable Object. A summary is
added later by the memory agent. The object is never wiped.

**Reasons.**

- Reversible compaction (archive + retrieval) beats overwrite-only summaries (2607.08032).
  OpenClaw, Hermes, and Cloudflare Agent Memory all keep raw history. Deleting from hot storage is
  fine; deleting the only copy is not.
- OpenClaw bounds session storage with `session.maintenance` (30 days, 5,000 rows by default), and
  Hermes deletes ended sessions with `prune`. Pruning is ordinary in existing systems.
- In kodama, compaction removes nothing from storage, so pruning has to be a separate step. A
  workerd experiment confirmed that after deleting entries below the head and terminal tasks, the
  conversation continues, the summary is sent, `snapshot()` is unchanged, and old request IDs stay
  deduplicated.
- The raw entries are indexed, not only their summary. What later needs to be found again is often
  what the summary and extraction left out, such as an error code (summarization drift,
  2603.07670). An index that depends on the summary cannot reach it.

**Rejected.**

- **Never prune.** Simplest, and 10 GB is far for text-only chat. It still fails hard at the limit.
  Phases 1–2 work in this mode; pruning can wait until measurements call for it.
- **Wipe the object and restart from a handoff note.** It uses only public Pi APIs (`reset()` and
  `deleteAll()`) and resembles Hermes starting a continuation session at each compaction. It breaks
  the conversation's continuity, needs restore-from-manifest logic and a generation number, and
  drops every subscriber. It remains the fallback if a Pi change ever makes pruning unsafe.
- **Index only the summary as a memory record** (the earlier version of this plan). A word missing
  from the summary was unreachable, and as an `event` the index could expire while the R2 object
  still existed.
- **Wait for an official pruning API in Pi Durable.** The better end state: Pi knows its own
  invariants (entries are immutable and IDs are never reused; forks read their parents). Worth
  proposing upstream, not worth waiting for; pruning stays in one module so it can be swapped.

### 4. Only a dedicated memory agent writes memory

**Decision.** Only the memory agent (`MemoryAgent`) writes long-term memory. Working agents have
search tools and `remember` only.

**Reasons.**

- Letta moved memory editing out of the conversing agent into a sleep-time agent: with memory
  management and conversation in one agent, the agent "may be slower (if it has to call memory
  operations during conversation) and potentially less reliable (since it calls both memory
  management tools and standard tools)".
- Cloudflare Agent Memory describes giving the model raw access to a store as "burning tokens on
  storage and retrieval strategy instead of the actual task".
- Hermes can run its memory review on a cheaper model than the main one. A separate memory agent
  can choose its own model the same way.
- Concurrent full rewrites of a shared block lose updates (Letta). With one writer, each scope has
  one writer and the problem does not arise.
- Sleep-time compute (2504.13171) shows that work done while idle reduces work at answer time.

**Rejected.**

- **Each working agent writes its own memory.** It puts memory tools and instructions into every
  request, spends the working model on bookkeeping, and leaves several writers per scope. Letta
  abandoned this shape.

### 5. The memory agent is an internal `Agent` subclass

**Decision.** `class MemoryAgent extends Agent` is its own Durable Object class, reached only
through the `MEMORY_AGENT` binding. It inherits `Agent` as it is; only the methods that would
bypass its job queue throw. `AgentService` cannot reach it yet.

**Reasons (kodama constraint).**

- `Agent` and Pi Durable already provide durable admission, deduplication by request ID, a serial
  inbox, and recovery. Memory jobs use them for the model part, behind kodama's own job runner
  (decision 14).
- A subclass with its own binding makes two things structural: public RPC cannot reach it, and its
  tools live in a separate registry.
- Inheriting `subscribe` and `snapshot` keeps the memory agent's work observable like any agent's,
  so a UI can show it later without new code in the agent.

**Rejected.**

- **A Cloudflare Workflow.** Workflows are not billed while waiting on the model, but this would
  rebuild what `Agent` already provides with a second execution model, its own tools, and its own
  tests. The saved duration is small (waiting costs $1.35 a month in the estimate of decision 1).
- **An `Agent` with a reserved ID in the public namespace.** Every public RPC method would need to
  reject that ID, and tool restrictions would depend on configuration checks.

### 6. Three write paths: `remember` in the turn, extraction when idle, daily consolidation

**Decision.**

- When the user asks, or the agent judges something worth keeping, the agent calls `remember` in
  the turn and the memory agent takes it as its next job.
- When the agent has been idle for a while, and when pruning finds the checkpoint behind, the
  memory agent extracts from the transcript, or from R2 for a range already pruned.
- Once a day, the memory agent consolidates.

**Reasons.**

- Every existing system has one or more of these three paths.

  | Trigger            | Existing systems                                                                                                            |
  | ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
  | Explicit, in turn  | Cloudflare Agent Memory `remember`; Hermes and OpenClaw memory tools                                                        |
  | In the background  | Grok Build (every turn), Hermes (review after turns), Cloudflare Agent Memory (at compaction), OpenClaw (before compaction) |
  | Periodic, in batch | OpenClaw dreaming, Grok Build `/dream`, Devin dreaming (about once a day)                                                   |

- Extraction reads the transcript, not the compaction. OpenClaw flushes memory before compaction
  because its context is the only place the agent looks. In kodama, compaction removes nothing from
  storage, so entries stay readable with `scanEntries` until they are pruned.
- Memory systems create and accumulate errors during extraction and updating (HaluMem,
  2511.03506), and past errors compound (error propagation, 2505.16067). Extracted candidates are
  checked against their cited entries, unsupported ones are dropped, and provenance is stored.
- Saves on the agent's own judgment are weaker than requested ones: lower importance, may be
  declined as duplicates or low value, archived if never used. Hermes does not remember facts
  mentioned in passing without a request to save them. Any user can inject memory (MINJA,
  2503.03704), so unrequested saves are not accepted unconditionally.

### 7. Four kinds; facts are superseded, events decay

**Decision.** Records are `fact`, `instruction`, `event`, or `task`. A newer fact or instruction
supersedes an older one by naming its ID, found by search. Events are ranked down by recency.

**Reasons.**

- The four kinds and supersession that marks the old record `superseded` instead of deleting it
  follow Cloudflare Agent Memory.
- Mem0 (2504.19413) retrieves similar memories and chooses ADD, UPDATE, DELETE, or NOOP for each
  candidate. Step 4 of extraction (add, supersede, invalidate, or skip) is the same choice, and the
  target is named by ID in the same way.
- Applying time decay to facts is a category error (2604.11364). Zep (2501.13956) handles outdated
  facts with edge invalidation. Events do decay with recency (Generative Agents, 2304.03442, decay
  factor 0.995).
- Models accept stale facts (STALE, 2605.06527: 55.2% accuracy), so supersession is explicit.

**Rejected.**

- **Topic keys** (Cloudflare Agent Memory gives facts and instructions a normalized topic key, and
  a new memory with the same key supersedes the old one). A key lets the database keep one active
  record per topic, but only if the model produces the same key for the same topic every time. A
  varying key silently stops supersession, and a key that is too coarse supersedes an unrelated
  fact. With one writer running one job at a time, the database guarantee is not needed, and
  duplicates from rewording are merged by consolidation.
- **A per-person scope** (Hermes's Honcho keeps a separate peer profile per counterpart). Kodama
  constraint: memory of the people an agent talks to is not needed.

### 8. Always-loaded memory is small, frozen, and changed only at idle boundaries

**Decision.** Always-loaded memory fits 2,200 characters for the agent and 1,000 for the shared
block. The agent object keeps a copy and refreshes it while idle: at start, on a change notice,
and when `scope_revisions` shows a newer revision before a turn.

**Reasons.**

- Hermes caps `MEMORY.md` at 2,200 characters and freezes it at session start to keep the prompt
  cache.
- Pi re-sends a changed section as a new system entry. Changing it mid-turn would cost a write and a
  cache miss each time.
- The budget display (`[67% — 1,474/2,200 chars]`) follows Hermes.
- A notice can be lost when the memory agent stops between its D1 write and the call. A revision
  written in the same batch as the change lets each agent notice the change itself, without the
  memory agent waking every agent (kodama constraint).

### 9. Search starts with a word index in D1 and Intl.Segmenter

**Decision.** Text segmented with `Intl.Segmenter` is indexed word by word in `memory_terms`, a
Drizzle table, and matches are ranked by importance, use, and recency. The raw text of archived entries is
indexed with the same words in per-range index files in R2, read newest first within a budget.
Vector search is not in the first version.

**Reasons.**

- Hermes's `session_search` is SQLite FTS5. OpenClaw's built-in search starts from SQLite BM25 and
  adds vectors only when an embedding provider is configured. Kodama keeps their word matching
  but not FTS5: FTS5 needs a virtual table and triggers that Drizzle cannot describe, and kodama
  writes no SQL by hand. The word table loses BM25's ranking by term frequency, which matters little
  for records of one or two sentences (kodama constraint).
- The survey 2603.07670 recommends starting simple and instrumenting.
- Japanese full-text search on D1 with FTS5 and `Intl.Segmenter` has been built before (coji on
  Zenn).
- `Intl.Segmenter` gives the same result in workerd as in Node. These queries all matched:
  「使う」, 「リポジトリ」, 「リポ」, 「デプ」, 「マネージャー」, 「レビュー」, 「サーバレス」 and
  「サーバーレス」, 「ベストプラクティス」, and 「ＰＮＰＭ 使う」.

- The archive index lives in R2 next to the entries it indexes (kodama constraint). It grows with
  the transcripts, tool output included, while D1 is one database of at most 10 GB for all agents
  and costs fifty times more per GB. In R2 the index and its entries are kept and deleted
  together, and building it needs no D1 batch limits.

**Rejected.**

- **FTS5's trigram tokenizer.** Trigram needs queries of at least three characters, so two-character
  words such as 「使う」 and 「リポ」 do not match. Its index is built per character position and is
  larger. `unicode61` alone treats a Japanese sentence without spaces as one token.
- **Vectors and RRF from the start** (Cloudflare Agent Memory, OpenClaw hybrid search). Start with
  full-text search, measure what it misses, then decide whether to add vectors.
- **FTS5 with a hand-written migration and triggers** (an earlier version of this
  implementation). It ranks by BM25, but its SQL lives outside Drizzle.
- **The archive index as FTS5 in D1** (the previous version of this plan). One global ranking over
  all archived text, but the index would soon dominate the shared D1 database.

### 10. Procedures are skills, loaded the way Pi loads them

**Decision.** Skills use the Agent Skills format in R2. A `skills` section lists name, description,
and path; the model reads the body with Pi's `read` tool, whose `env` is a read-only `ExecutionEnv`
over R2 (`SkillsEnv`).

**Reasons.**

- Every existing system keeps procedures apart from facts as skills and shows only name and
  description up front (Anthropic's progressive disclosure).
- Claude Code: "If an entry is a multi-step procedure … move it to a skill."
- Pi lists skills by name and description and the model reads the body with `read`. Loading skills
  the same way keeps skills that refer to bundled files by relative path working.

**Rejected.**

- **Custom skill tools** (`skill_load`, `skill_search`). They duplicate Pi's `read` tool and break
  skills that refer to their bundled files by relative path.

### 11. Skills come only from verified experience and stay few

**Decision.** A skill is created only from a procedure that succeeded at least twice, and becomes
active after a check. The list holds at most 50 skills; unused skills become stale and are then
archived.

**Reasons.**

- Skills induced from successful, verified trajectories help: AWM (2409.07429) +24.6% and +51.1%
  relative, ASI (2504.06821) +23.5%, "mainly thanks to the programmatic verification guarantee".
  ReasoningBank (2509.25140) distills lessons from failures as well as successes.
- Skills an agent writes before doing the work score 8.1 to 11.5 points below no skills
  (SkillsBench, 2602.12670). In the same paper, focused skills with at most three modules beat
  larger bundles.
- Repeated updates introduce episode-specific drift and procedural clutter (SkillEvolBench,
  2605.24117).
- Selection accuracy drops with library size: 96–98% at 16–32 skills, 92% at 64, 78% at 128
  (2607.10113). The limit of 50 comes from these numbers.
- Hermes's curator marks skills stale after 14 days unused and archives them after 30, never
  deletes automatically, exempts pinned skills, and archives merged skills with `absorbed_into`.
  The agent-skill windows and `absorbed_into` follow it.

### 12. Skills have two scopes: agent-specific and shared

**Decision.**

- Skills are scoped `agent:<agentId>` or `shared:<space>`; `sharedSpaces` sets the shared spaces an
  agent reads.
- An agent skill shadows a shared skill with the same name.
- A skill starts as an agent skill and is promoted to a shared skill through a checked proposal
  when two or more agents have the same procedure.
- A shared skill changes only through an accepted proposal.
- Skills are overwritten in place. An update first records its per-file before and after hashes,
  so a stop is finished on restart, and the ledger keeps the before files for rollback.
- A shared skill is curated only after no agent uses it, over a longer window.

**Reasons.**

- Layering and shadowing follow existing systems. Hermes ranks project, local, and external
  directories in that order; the higher-precedence directory wins a name and the shadowed copy is
  logged. Project skills override same-named ones so that "vendored repo skills win on their home
  turf". Pi keeps the first discovered skill on a name collision and warns. Each name appears once
  in kodama's list for the same reason.
- Shared skills are protected from writers structurally. In Hermes, agent-created skills go to the
  local directory, but existing skills are edited where they are found, and the documentation warns
  that "external dirs are not a write-protection boundary" and recommends filesystem permissions.
  In kodama, the memory agent's `skill_write` accepts only agent scopes, and shared skills are
  written only by `apply_proposal`.
- Promotion goes through the same proposal checks as shared memory (decision 13). Implanted
  "successful experiences" persist (MemoryGraft, 2512.16962), which makes shared skills especially
  risky. Collaborative Memory (2505.18279) also uses a write policy to place fragments in private or
  shared tiers, with immutable provenance.
- Success of the same procedure in two or more agents is evidence that it is not one agent's quirk.
  This applies decision 11's "verified experience" across agents (kodama constraint).
- Overwriting with a ledger follows Hermes. Hermes edits skills where they are found and keeps no
  side-by-side versions. Every skill mutation goes to an append-only ledger with per-file SHA-256
  before and after, file contents are stored content-addressed, and a single mutation can be rolled
  back, including a deleted skill. A skill stays a plain directory, as in Hermes and Pi.
- Recording the write before touching files handles a stop in the middle (kodama constraint).
  Without it, a stop leaves a mix of old and new files as the current skill, and the ledger cannot
  say how far the update got. With the after files already in blobs, finishing an update is a copy
  that can be repeated.
- Promotion archives a source agent skill only if that agent's name resolution then yields the
  shared skill (kodama constraint). Agents may read different shared spaces, or an earlier space
  may hold a skill with the same name; two agents succeeding with a procedure is a reason to
  propose a shared skill, not a reason to delete their copies.
- Shared skills are kept longer because two or more agents backed them and they serve several
  agents. Hermes's
  curator by default curates only agent-created skills, because bundled skills disappearing silently
  looks like a broken install. Kodama curates shared skills too, with twice the window, and archived
  skills can be restored (kodama constraint).
- A per-agent override wins only for that agent, like a Hermes project skill. When several agents
  override a shared skill the same way, that becomes evidence for an update proposal (kodama
  constraint).

**Rejected.**

- **One R2 directory per version** (`skills/<scope>/<name>/v<version>/`). Unchanged files are
  copied for every version.
- **Switch an immutable manifest of content-addressed files.** Readers would never see a mix, but
  every read goes through the manifest and a reader has to pin it while it reads a skill. The
  short mix during an update is accepted instead (see Weak points).
- **Shared skills only** (one list for all agents). A procedure that succeeded in one agent would
  reach every agent, against decision 11, and the list would grow with the number of agents.
- **Agent skills only.** Each agent would relearn the same procedures, and improvements would not
  be shared.

### 13. Shared memory is written through checked proposals, with provenance

**Decision.** Shared scopes are written only when a proposal from the memory agent passes checks
in code and is then applied against the revision it was written for. No person approves or
reviews a change. Bringing a record or skill into a space needs active records or skills of at
least two agents as its sources; reorganizing a space needs sources that are all its own records.
Applied proposals become new records; shared records are not rewritten in place. Every proposal,
decision, and application is in the ledger. Secrets are redacted and text that reads as
instructions is rejected before any write.

**Reasons.**

- Kodama's agents run unattended for months, and a person in the loop would leave proposals
  waiting and shared memory stale. Approval by people is not part of the design (kodama
  constraint).
- Any user can inject memory (MINJA, 2503.03704).
- Prompt-injection defenses do not cover memory poisoning (MPBench, 2606.04329).
- Multi-agent memory consistency is the most pressing open challenge and needs structured memory
  access control (2603.10062).
- Collaborative Memory (2505.18279) splits memory into private and shared tiers, builds each
  agent's view with read and write policies, and keeps immutable provenance. The checks are such a
  write policy, applied in code.
- OpenClaw does not store a report from an untrusted source as durable memory until a trusted
  reviewer confirms it. Kodama has no reviewer, so it asks for confirmation from a second agent
  instead: one poisoned conversation, or one agent's quirk, cannot reach every agent on its own.
  This is the same evidence rule as skill promotion (decision 12).
- Hermes scans memory entries for injection and exfiltration patterns before accepting them.
- Cloudflare Agent Memory shows memory profiles shared across agents and people, so sharing itself
  is an ordinary shape.
- A single writer does not stop an outdated change: two proposals written against the same
  revision, applied one after the other, would let the older one undo the newer. Checking
  `base_revision` at application turns that into a `conflict` (kodama constraint).
- Separating `accepted` from `applied` makes the accepted row itself the pending work, so a stop
  between the decision and the job does not lose the application (kodama constraint).

**Rejected.**

- **Approval by a person** (`listProposals` and `decideProposal` on `AgentService`). Proposals
  would wait for someone indefinitely, and the agents are meant to run on their own.
- **Letting the memory agent write shared scopes directly.** One agent's conversation, poisoned
  or not, would reach every agent with no second source.

### 14. Writes, jobs, and pruning survive retries and stops

**Decision.** Every write is an operation with an `op_id` and expectations. The memory agent runs
one job at a time behind its own queue and resets before each job. Pruning is a resumable state
machine whose final step rechecks its conditions in a short exclusive section.

**Reasons.**

- `INSERT OR IGNORE` also ignores the violation of the partial unique index, and D1's `batch()`
  rolls back only when a statement fails. A minimal SQLite run of the earlier rules showed that
  repeating a supersede marked the current record `superseded` and left no active record. Checking
  `memory_ops` before any change, and plain inserts inside the batch, make a repeat a no-op and an
  unexpected state a rollback.
- In Pi Durable 1.2.0, `reset()` resolves once the reset is admitted, not placed. A job queued
  behind another starts at the earlier job's final boundary, and a reset placed at its next
  `postTools` boundary ends it `unanswered` with reason `reset` (spec §6). Resetting after each job
  could therefore cut the next one, which might also see the previous job's context. With one job
  at a time and the reset admitted while idle, Pi places it at once, before the next input.
- Pi's idle wait does not include background tasks, and a background compaction rereads entries
  from its recorded `tail` when it resumes (spec §8.7). Deleting entries under a live background
  compaction would remove what it needs. Conditions checked at the start can also change while R2
  is written, so they are checked again right before deletion.
- `blockConcurrencyWhile` has a 30-second timeout, so it cannot cover R2 transfers; only the local
  recheck and deletion run inside it.
- `sendMessage` returns when a submission is admitted, not when the memory agent finishes. Pruning
  therefore deletes only after its own code has written the archive index and catalog, not after
  a job is
  merely accepted.

**Rejected.**

- **Restrict `INSERT OR IGNORE` to the primary key** (`ON CONFLICT (id) DO NOTHING`). It removes
  the contradiction with the rollback rule but not the invalidation of the current record on a
  repeat.
- **Wrap the whole pruning run in `blockConcurrencyWhile`.** The R2 transfer can exceed its
  timeout.

### Weak points

To check before the design is settled:

- **Whether production `databaseSize` falls after pruning** is not verified. Locally it fell from
  20.5 MB to 5.1 MB.
- **`submissions` are never pruned.** One row per input stays for the life of the agent.
- **Rows written per turn** were measured in workerd (`test/measurement.test.ts`, Pi Durable 1.2.0):
  about 111 rows for a one-second, 40-delta stream at 100 ms, and about 66 at 1 s. That is about
  five rows per progress commit plus about 66 per turn. Production numbers may differ.
- **A known search miss:** 「プラクティス」 alone does not match 「ベストプラクティス」.
- **The failure handling is checked against the Pi Durable 1.2.0 spec and SQLite, not yet run in
  workerd.** The background compaction check and resuming a stopped run are tested in workerd
  (`test/prune.test.ts`); the reset ordering and D1 `batch()` rollback need the phase 4 failure
  tests.
- **An earlier always-loaded memory stays in the conversation.** Pi appends a changed section as
  a message, so the model sees the old version followed by the new one until compaction removes
  it. The newest version is last and marked as an update.
- **A read during a skill update can see old and new files mixed** until the update finishes.
  Updates run only in consolidation and `apply_proposal`, and `SKILL.md` is written last, so this
  is accepted (Hermes has the same behavior).
- **`history_search` reads index files newest first within a budget**, so it has no ranking
  across all ranges, and finding something old takes several calls with `before`. The number of
  ranges a call covers depends on index size, which is not measured.
- **D1 is one database of at most 10 GB for all agents.** Extracted records are small, but
  ledger rows and proposals add up. Consolidation records the size; when to split
  the database is not decided.
- **Shared-skill curation windows (30 and 60 days), agents needed to promote (2), and the list
  limit (50)** are not taken directly from outside evidence. 50 leaves a margin under the numbers
  in 2607.10113; the rest are kodama choices.
- **Not reached.** No official description of how @grok on X keeps memory was found. Hermes issue
  #22620 (skill listings inflating context) and OpenClaw issue #45608 returned 403 from GitHub. No
  independent measurement comparing regenerated and anchored summaries over many compactions of one
  session was found.
- **Sources that disagree.** Whether OpenClaw discards sessions daily: a Zenn article says sessions
  are discarded at 4 a.m. every day; the official documentation says there is no automatic reset by
  default. This document follows the official documentation.

## Open questions

- How long must archived entries be kept, and who may delete them?
- Who may roll back a skill change, and through which RPC?
- Which model should the memory agent use?
- How coarse may live streaming to the UI become in exchange for fewer writes?

## Sources

- Pi Durable 1.2.0 README and spec: https://github.com/earendil-works/pi/blob/main/packages/durable/docs/spec.md
- Pi coding agent documentation (skills, compaction): https://github.com/earendil-works/pi
- Durable Objects pricing, limits, FAQ, SQLite storage API: https://developers.cloudflare.com/durable-objects/platform/pricing/
- D1 pricing, limits, Time Travel, SQL statements (FTS5): https://developers.cloudflare.com/d1/platform/pricing/
- R2 pricing: https://developers.cloudflare.com/r2/pricing/
- OpenClaw memory, compaction, sessions: https://docs.openclaw.ai/concepts/memory
- Hermes Agent memory, sessions, skills, curator: https://hermes-agent.nousresearch.com/docs/user-guide/features/memory
- Grok Build memory: https://x.ai/news/grok-build-memory
- Cloudflare Agent Memory: https://blog.cloudflare.com/introducing-agent-memory
- Cloudflare Agents memory and sessions: https://developers.cloudflare.com/agents/concepts/memory/
- Letta shared memory and sleep-time agents: https://docs.letta.com/v1-sdk/memory/shared-memory
- Devin memory and dreaming: https://docs.devin.ai
- Claude Code memory: https://code.claude.com/docs/en/memory
- Anthropic, Equipping agents for the real world with Agent Skills: https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
- Anthropic, Effective context engineering for AI agents: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Factory, Evaluating context compression: https://factory.ai/news/evaluating-compression
- coji, Japanese full-text search with Cloudflare D1 FTS5: https://zenn.dev/coji/articles/cloudflare-d1-fts5-japanese-search-api
- Papers (arXiv): CoALA 2309.02427, MemGPT 2310.08560, Generative Agents 2304.03442,
  Mem0 2504.19413, Zep 2501.13956, ACE 2510.04618, Complexity Trap 2508.21433,
  rate–distortion compaction 2607.08032, survey 2603.07670, HaluMem 2511.03506,
  memory management impacts 2505.16067, STALE 2605.06527, missing knowledge layer 2604.11364,
  Voyager 2305.16291, AWM 2409.07429, ASI 2504.06821, ReasoningBank 2509.25140,
  SkillsBench 2602.12670, SkillEvolBench 2605.24117, skills survey 2607.10113,
  Collaborative Memory 2505.18279, multi-agent memory 2603.10062, MINJA 2503.03704,
  MemoryGraft 2512.16962, MPBench 2606.04329, sleep-time compute 2504.13171
