# Long-term memory for long-running agents

Status: proposal. Nothing in this document is implemented yet.
A Japanese explanation is in [long-term-memory.ja.md](long-term-memory.ja.md).

Kodama agents are meant to run like an always-on bot: one agent keeps answering and working
in the same conversation for weeks or months. This document proposes how an agent remembers
what matters and lets go of the rest, so that neither its model context nor its Durable Object
storage grows without bound, and without making Durable Objects the store for everything.

## Problem

Each agent is one SQLite-backed Durable Object that owns a Pi Durable session.

- **Context is already bounded.** Pi Durable compacts automatically (defaults: `reserveTokens`
  16384, `keepRecentTokens` 20000, `backgroundTokens` 32768). Kodama does not configure
  compaction, so these defaults apply.
- **Storage is not bounded.** Pi entries are immutable and never removed. A compaction or
  `reset()` only moves the context head: "A head on an entry changes subsequent context; it
  does not remove older entries from storage" (Pi Durable spec §2.1). Terminal task records and
  section changes also stay. Pi has no public API to prune them.
- **The hard limit is 10 GB per object.** At the limit, writes fail with `SQLITE_FULL`; reads
  and deletes still succeed (Durable Objects FAQ). An agent that hits it stops working.
- **Summaries cannot hold everything.** Pi's summary uses the coding agent's structured
  checkpoint format and carries the earlier summary forward (spec §8.7), which is the right
  default. Any summary still loses rare details over many cycles ("summarization drift", arXiv
  2603.07670), and loses more facts as compaction frequency rises when nothing reversible backs
  it (arXiv 2607.08032: recall 0.33–0.56 vs. about 0.95 with a retrievable archive). The answer
  is to keep facts and the raw record outside the summary, not to replace Pi's summarizer.
- **One endless session is the worst case for learning.** Hermes Agent documents this for
  gateway chats: a single session "grows expensive (compaction runs repeatedly over an
  ever-longer history) and the learning loop … almost never gets to fire."

## Where the Cloudflare cost comes from

Prices are from the Cloudflare pricing pages (Workers Paid, October 2026). Allowances below are
per account per month.

| Item                              | Price                                                  | Included     |
| --------------------------------- | ------------------------------------------------------ | ------------ |
| Durable Object duration           | $12.50 per million GB-s, billed on 128 MB while active | 400,000 GB-s |
| Durable Object or D1 rows written | $1.00 per million rows (deletes count)                 | 50 million   |
| Durable Object or D1 rows read    | $0.001 per million rows                                | 25 billion   |
| Durable Object SQLite storage     | $0.20 per GB-month                                     | 5 GB         |
| D1 storage                        | $0.75 per GB-month                                     | 5 GB         |
| R2 Standard storage               | $0.015 per GB-month                                    | —            |
| R2 writes / reads                 | $4.50 / $0.36 per million operations                   | —            |

What this means for one agent that streams model output 8 hours a day for 30 days, counted
beyond the allowances:

| Cost source                                                                                                              | Estimate                   | Lever                            |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------- | -------------------------------- |
| Pi progress commits while streaming: at most one commit per 100 ms (`progress.partialIntervalMs`), at least one row each | ≥ 8.6 million rows, ≥ $8.6 | raise the interval               |
| Duration while waiting on the model                                                                                      | 108,000 GB-s, $1.35        | unavoidable while the model runs |
| An open `subscribe()` stream all day (no hibernation)                                                                    | 324,000 GB-s, $4.05        | close streams nobody watches     |
| 1 GB of transcript kept in the object                                                                                    | $0.20 per month            | archive to R2 ($0.015)           |

The rows per progress commit have not been measured. Phase 1 measures them with
`SqlStorageCursor.rowsWritten` in the integration tests.

Two conclusions follow:

1. **The largest costs are write volume and active time, not stored bytes.** Moving data out of
   Durable Objects does not reduce them; tuning Pi's progress interval and stream lifetime does.
2. **Long-term memory does not belong in the agent's Durable Object.** Per row and per GB a
   Durable Object is not more expensive than D1, but memory must be shared between agents and
   readable by the UI and by maintenance jobs without waking agent objects, and the session's
   own rows are pruned over time. Each of these pushes memory into a separate store.

## What existing systems do

| System                                 | Always-loaded memory                                                   | Searchable memory                                       | Write trigger                                                                          | Old history                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| OpenClaw                               | `MEMORY.md`, `USER.md`                                                 | daily notes, hybrid BM25 + vector, 30-day decay         | agent writes; silent "memory flush" turn before compaction; daily "dreaming" promotion | transcript kept on disk; `session.maintenance` prunes after 30 days                          |
| Hermes Agent                           | `MEMORY.md` (2,200 chars), `USER.md` (1,375 chars), frozen per session | `session_search` over SQLite FTS5                       | memory tool; background review after turns                                             | compaction starts a continuation session (lineage); export-then-delete, prune ended sessions |
| Grok Build                             | per-project and global markdown topics                                 | topic files read on demand                              | background capture after every turn; `/dream` merges                                   | —                                                                                            |
| Cloudflare Agent Memory (private beta) | —                                                                      | facts, events, instructions, tasks; FTS + vectors + RRF | bulk ingestion at compaction; `remember`/`forget` tools                                | raw messages kept as a low-weight search channel; facts superseded, not deleted              |
| Letta                                  | memory blocks                                                          | archival memory                                         | memory tools; sleep-time agent                                                         | git-backed memory repos; shared repos across agents                                          |

Procedures are kept apart from facts in all of them: Hermes, OpenClaw, Claude Code, and
Cloudflare Agents load **skills** on demand (name and description in the prompt, body loaded
when relevant). Claude Code's guidance: "If an entry is a multi-step procedure … move it to a
skill."

## Findings that shape the design

1. **Keep the raw record retrievable.** Reversible compaction (archive + retrieval) beats
   overwrite-only summaries (2607.08032). OpenClaw, Hermes, and Cloudflare all keep raw
   history. Deleting from hot storage is fine; deleting the only copy is not.
2. **Leave compaction to Pi.** Pi already selects the cut, summarizes in a structured format,
   carries the earlier summary forward, retries, and recovers from context overflow. The
   evidence for custom summarizers is from other settings (ACE rewrites a playbook, not a
   conversation) or vendor-measured (Factory). Owning the summary would mean owning its prompt,
   failures, and regressions for an unproven gain. Observation masking (2508.21433) is the same
   kind of optimization and waits until measurements show tool output dominating the context.
3. **Extract memories from the transcript, not from the compaction.** OpenClaw flushes memory
   before compaction because its context is the only place the agent looks. In kodama,
   compaction removes nothing from storage, so entries stay readable (`scanEntries`) until they
   are pruned. Extraction can run in the background after the agent goes idle (like Grok Build
   and Hermes) and must run before pruning.
4. **Verify what is extracted.** Extraction and updating are where memory systems create and
   accumulate errors (HaluMem 2511.03506), so extracted items need verification against the
   transcript and provenance.
5. **Facts and episodes need different lifetimes.** Facts are superseded, not decayed; episodes
   decay with recency (2604.11364, Zep edge invalidation, Generative Agents decay 0.995).
   Models still accept stale facts (STALE 2605.06527: 55.2%), so supersession must be explicit.
6. **Skills must come from verified experience.** Skills induced from successful, verified
   trajectories help (AWM +24.6%/+51.1%, ASI +23.5%, ReasoningBank). Skills an agent writes
   before doing the work hurt (SkillsBench: −8.1 to −11.5 pp). Small skills beat large bundles,
   repeated updates add clutter (SkillEvolBench), and flat selection degrades past roughly 64
   skills (2607.10113). Curation must archive unused skills (Hermes curator: stale at 14 days,
   archived at 30, never auto-deleted).
7. **Shared memory is an attack and consistency surface.** Any user can inject memory (MINJA),
   poisoned "successful experiences" persist (MemoryGraft), and prompt-injection defenses do not
   cover memory poisoning (MPBench). Shared blocks lose updates under concurrent full rewrites
   (Letta). Shared writes need provenance, a single writer per record, and review.
8. **Freeze what is always loaded.** Hermes freezes its memory snapshot per session to keep the
   prompt cache; Pi re-sends changed sections as new system entries. Always-loaded memory should
   change only at idle boundaries.
9. **Give memory its own writer.** Letta moved memory editing out of the conversing agent into
   a sleep-time agent, because bundling memory management with conversation made the agent
   slower and less reliable; the primary agent keeps only search tools. Cloudflare Agent Memory:
   "The primary agent should never burn context on storage strategy." Hermes can run its memory
   review on a cheaper model (about 3–5 times cheaper). A single writer also settles the
   consistency problem from finding 7.

## Design

### Storage layers

| Layer            | Store                                  | Contents                                                                                                      | Lifetime                    |
| ---------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Session          | the agent's Durable Object (unchanged) | Pi Durable session; a frozen copy of the always-loaded memory                                                 | old rows pruned             |
| Long-term memory | one D1 database `MEMORY_DB`            | memory records and their FTS5 index, extraction checkpoints, shared-memory proposals, skill index, and ledger | kept                        |
| Archive          | R2 bucket `ARCHIVE`                    | pruned entries in chunks, each with a manifest (entry range, summary, counts, SHA-256), skill bodies          | retention rule              |
| Optional         | Vectorize                              | embeddings of memory records                                                                                  | added only if search misses |

The only new Durable Object class is `MemoryAgent`, a subclass of `Agent` that is reachable
only from inside the Worker (see below). Agents read D1 and R2 through Worker bindings; only
the memory agent writes long-term memory.

D1 fits long-term memory because it supports FTS5, keeps 30 days of point-in-time recovery
(Time Travel), and can be read by the UI Worker and by maintenance jobs without waking an
agent. A database holds up to 10 GB; memory records are small, and D1 is designed to be split
into more databases (for example per agent group) if one ever fills up.

### Memory scopes

| Scope                                                      | Contents                                                   | Writes                         |
| ---------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------ |
| **Context**                                                | current turns, compaction summary                          | Pi, inside the session object  |
| **Agent** (`agent:<id>`)                                   | the agent's notes, learned conventions, events, its skills | the memory agent               |
| **Shared** (`shared:<space>`, for example `shared:global`) | team conventions, shared facts, shared skills              | the memory agent, after review |

There is no per-person memory. Facts about the people an agent works with are ordinary agent
facts when they matter for the work.

### Components and calls

The memory agent is a `MemoryAgent`: a subclass of `Agent` with the same Pi session, inbox,
and recovery alarm, exported as its own Durable Object class with a single instance. Only
internal callers hold its binding.

```text
AgentService (public RPC entrypoint)
  `-- AGENTS ---------------------> Agent DO (agentId)   MemoryAgent is not reachable from here

Agent DO (agentId)
  |-- reads ----------------------> D1 MEMORY_DB         memory_search, skills, always-loaded memory
  |-- MEMORY_AGENT.sendMessage ---> MemoryAgent DO       remember, idle extraction, before pruning
  `-- writes ---------------------> R2 ARCHIVE           entries about to be pruned

MemoryAgent DO (the single instance "memory")
  |-- reads and writes -----------> D1 MEMORY_DB         through its memory-writing tools
  |-- reads ----------------------> R2 ARCHIVE           evidence for consolidation, skill bodies
  |-- AGENTS readEntries ---------> Agent DO             extraction only, paged
  `-- AGENTS memoryChanged -------> Agent DO             refresh always-loaded memory at the next idle

scheduled handler --------------> MemoryAgent DO       daily consolidation
```

The new bindings are `MEMORY_AGENT` (Durable Object), `MEMORY_DB` (D1), and `ARCHIVE` (R2).
`AgentService` resolves only `AGENTS`, so neither the UI nor any other RPC caller can send to,
subscribe to, or configure the memory agent, and a user agent named `memory` is unrelated to it.

### D1 schema

The proposed schema is in [long-term-memory.sql](long-term-memory.sql). It ships as a D1
migration managed with `cf d1 migrations`.

| Table                     | Rows                                                                                  | Written by                     |
| ------------------------- | ------------------------------------------------------------------------------------- | ------------------------------ |
| `memory_records`          | one memory: fact, event, instruction, or task, with scope, status, origin, and source | memory agent                   |
| `memory_fts`              | FTS5 index over `memory_records` (external content, kept in sync by triggers)         | triggers                       |
| `extraction_checkpoints`  | last extracted entry per agent                                                        | memory agent                   |
| `skills` and `skills_fts` | skill index (name, description, status, R2 key, evidence) and its search index        | memory agent                   |
| `shared_proposals`        | pending, accepted, or rejected proposals for shared memory                            | memory agent; reviewer decides |
| `memory_ledger`           | append-only log of every change, including declined candidates                        | memory agent, reviewer         |

There is no table of sessions or generations. Pi never reuses entry IDs, and pruning keeps the
same session, so an agent's entries form one sequence for its whole life. Archives are keyed by
entry range.

Rules that shape the tables:

- **Record IDs** are a SHA-256 of scope, kind, topic key, content, and source (agent and first
  entry). Repeating the same run writes nothing new (`INSERT OR IGNORE`), and
  a fact the user states again later gets a new record instead of colliding with a superseded
  one.
- **One active record per topic.** A partial unique index on `(scope, kind, topic_key)` where
  `status = 'active'` makes superseding safe without locks: the memory agent marks the old record
  superseded and inserts the new one in one `batch()` (a D1 transaction). If another write got there
  first, the insert violates the index and the whole batch rolls back; the memory agent rereads and
  tries again.
- **`superseded_by` is not a foreign key.** D1 enforces foreign keys immediately, and the old
  row is marked before the new row exists.
- **`origin`** records why a record exists: `user_request`, `agent_judgment`, `extraction`,
  `consolidation`, or `archive` (the summary of an archived range of entries). (`trigger` would collide
  with an SQL keyword.)
- **Validity in time** comes from `observed_at` (when it became true) and the ledger entry that
  superseded or invalidated it. There is no separate validity table.
- **Checkpoints** have one writer: the memory agent, which handles its inbox one job at a time.
  If two jobs ever covered the same range, content-addressed IDs would make the overlap
  harmless.

Main queries:

- Always-loaded memory: active `instruction` and `fact` records of the agent's scope and the
  shared scope, ordered by `pinned`, `importance`, and `last_used_at`, cut to the character
  budget in code. There is no separate block table; consolidation shapes the result by
  adjusting importance and pinning.
- `memory_search`: `memory_fts MATCH ?` joined to active records in the allowed scopes, ranked
  by `bm25()` and then by recency and importance in code. It updates `use_count` and
  `last_used_at` of the returned rows in one statement, which costs one row written per result.

#### Japanese search with Intl.Segmenter

FTS5's default `unicode61` tokenizer only splits on spaces and punctuation, so a Japanese
sentence would be one token. Instead of the `trigram` tokenizer, the Worker splits text into
words with `Intl.Segmenter` and stores them space-separated in a `search_text` column; FTS5
then indexes those words with `unicode61`. This finds two-character words such as 「使う」,
which `trigram` cannot (it needs at least three characters). It should also keep the index
smaller, since trigram indexes every character position, and it ranks with `bm25()` over
words. It needs no tokenizer beyond the default one that D1 is certain to have.

This is the approach of
[個人開発に無料の日本語全文検索を](https://zenn.dev/coji/articles/cloudflare-d1-fts5-japanese-search-api)
(Coji Mizoguchi, 2026), with katakana handling and a prefix retry added after testing.

Writing `search_text`:

1. Normalize with NFKC and lowercase (full-width 「ＰＮＰＭ」 becomes `pnpm`).
2. Segment with `new Intl.Segmenter('ja', { granularity: 'word' })` and keep `isWordLike`
   segments.
3. In each segment, drop long vowel marks after katakana, as the article proposes, so 「サーバ」
   and 「サーバー」 match. This runs after segmentation; doing it before changes how the
   dictionary splits the text. The cost is conflating pairs such as 「ラーメン」 and 「ラメン」.
4. Merge adjacent katakana segments into one word. The dictionary splits unknown loanwords
   into fragments (「リポジトリ」 becomes 「リ / ポジ / トリ」), which makes prefix search fail.
5. Append the original segments that differ from the merged words, so a part of a compound
   still matches (「マネージャー」 finds 「パッケージマネージャー」).

Querying:

1. Apply the same steps to the query, quote each merged word, and join them, which FTS5 reads
   as `AND` (`"pnpm" "を" "使う"`), as in the article.
2. If that returns nothing, retry with each word as a prefix (`"デプ"*` finds 「デプロイ」).

Known misses: a katakana word inside a longer compound that the dictionary splits differently
in context. 「プラクティス」 alone is one segment, but 「ベストプラクティス」 is split into single
characters, so 「プラクティス」 does not find it. Word-based search cannot fix this; trigram
could, at the cost of the problems above.

`search_version` records which segmentation produced a row. If the rules or the runtime's ICU
data change, consolidation re-segments rows with an older version; the FTS5 triggers update
the index.

Retention: consolidation deletes archived events and old ledger rows in small batches (D1
asks for large deletes to be split). Time Travel covers restores of the whole database for 30
days.

The schema was checked with SQLite 3.45: the partial index rejects a second active record for
a topic, and a stale superseding batch rolls back. `Intl.Segmenter` was run in workerd
(2026-10-12) and gave the same segments as Node. With the rules above, 「使う」, 「リポジトリ」,
「リポ」, 「デプ」, 「マネージャー」, 「レビュー」, 「サーバレス」 and 「サーバーレス」,
「ベストプラクティス」, 「ＰＮＰＭ 使う」, and 「pnpmを使う」 found their records; 「プラクティス」
did not, as described above.

### Lifetimes by kind

- **fact**: no decay. A new fact with the same key supersedes the old one and keeps the chain.
- **event**: ranked by recency (half-life configurable, 30 days by default, as in OpenClaw) and
  archived after the retention window.
- **instruction**: multi-step instructions become skill candidates during consolidation.
- **task**: dropped when done.

Hard deletion is an operator action (privacy), not something the agent does.

### Always-loaded memory

A Pi prompt section renders two capped blocks from D1 records (see the main queries above):
the agent's own memory and a small shared block. Each block has a character budget shown in
the prompt (Hermes shows `[67% — 1,474/2,200 chars]`). The session object reads the blocks
from D1 when it starts and when the memory agent reports a finished job while the agent is
idle, and keeps the rendered text in a Pi document.
Requests in between read that copy, so the prompt prefix stays stable and no request waits on
D1.

### The memory agent

Long-term memory has one writer: the **memory agent**. Working agents only read memory and ask
for things to be remembered.

- **What it is.** `MemoryAgent extends Agent`, with one instance named `memory`. It reuses the
  whole `Agent` implementation and overrides only what makes it the memory agent: a fixed
  configuration built in code (a cheaper model from `MEMORY_MODEL_PROVIDER` and
  `MEMORY_MODEL_ID`, the memory-keeping system prompt), its tool registry, the reset after each
  job, and no background extraction of its own transcript. `setConfig` is not available on it.
- **Internal only.** Its binding is not part of `AgentService`, so it receives jobs only from
  kodama's own code: working agents' tools, pruning, and the `scheduled` handler. It never
  talks to users and has no conversation anyone watches.
- **Tools only it has.** `memory_write`, `memory_supersede`, `memory_decline`, `read_entries`,
  `skill_propose`, `shared_propose`, and `notify_memory_changed` are registered only in
  `MemoryAgent`'s registry. Working agents' registry does not contain them, so no configuration
  can enable them elsewhere.
- **Structured jobs.** A job is a JSON message validated with valibot (`remember`, `extract`,
  `record_archive`, `consolidate`), not free chat.
- **How jobs arrive.** Through the `sendMessage` method every agent already has, called on the
  `MEMORY_AGENT` binding. Admission is durable and does not wait for the model, so callers are not
  held up. Pi queues jobs that arrive while the memory agent is busy and runs them one at a
  time, which makes it the single writer without locks.
- **Idempotency.** A job's `requestId` is a hash of the source agent, the source entry, and the
  content. A repeated delivery with the same request ID returns the existing submission instead
  of running the job twice.
- **Its own context.** Jobs are independent. The memory agent resets its context between jobs (a
  per-agent setting applied when a submission settles, using Pi's `reset()`), so each job starts
  small, and its storage is reclaimed by the same pruning as any agent, without the extraction
  step. Background extraction is disabled for the memory agent
  itself, so it never feeds on its own transcript.
- **Cost.** It is billed Durable Object duration while it waits on its model. At an assumed
  1,000 jobs a day of 10 seconds each, that is about 37,500 GB-s a month, or $0.47 beyond the
  allowance. Reusing `Agent` is worth that.
- **Supersession safety.** Every write supersedes a record only through the partial unique
  index (see D1 schema), so even a manual operator write cannot leave two active records for a
  topic.
- **Working agents keep a small tool surface**: `memory_search`, `history_search`,
  `skill_search`, `skill_load`, and `remember`. `remember` sends a job to the memory agent at
  once; it does not write memory records itself.

### Write paths

All writes below are done by the memory agent.

1. **Remember during the turn.** The working agent calls `remember` in two cases:
   - **The user asks.** "Remember …", or a standing instruction ("always …", "from now on …").
     OpenClaw works the same way ("If you want your agent to remember something, just ask
     it").
   - **The agent judges it worth keeping.** Nobody said "remember", but the agent sees that a
     later session will need it: a decision and its reason, a correction from the user, a
     lesson from a failure, or a durable fact it had to look up. Hermes and the Claude memory
     tool let the agent manage its memory this way.

   The prompt says what is worth keeping and what is not, following Grok Build: keep
   conventions, decisions with their reasons, and durable facts; leave out task state,
   tentative conclusions, secrets, and anything the repository or its docs already cover.
   One-off tasks are not remembered. At most a few `remember` calls are accepted per turn.

   Both cases take the same path:
   1. The tool validates the request with valibot, caps its size, and scans it for injection
      patterns.
   2. It sends a `remember` job to the memory agent right away with `sendMessage`, carrying the
      request, its origin, and the IDs of the entries it came from. The request ID is a hash of
      the agent ID, the source entry, and the content, so a tool call repeated after a restart
      finds the existing submission instead of starting a second job.
   3. It returns once the job is durably admitted, so the turn is not held up and the working
      agent is not billed for the memory agent's model time.
   4. The memory agent classifies the request (usually an instruction or a fact), reconciles it with
      existing records (a new instruction supersedes the one it replaces), and writes it to
      D1. It is one small model call, not a scan of the transcript.
   5. It then tells the working agent's object that memory changed. The new block appears in the
      always-loaded memory at the next idle boundary; until then the instruction is still in the
      current context. Other agents that read the same scope see it on their next refresh.

   Later extraction sees the same message in the transcript and finds an equivalent record, so
   it writes nothing new.

   The record's provenance says which case it came from (`user_request` or `agent_judgment`).
   A user request is written as asked, unless it conflicts with a record the user made
   earlier, in which case the newer one supersedes it. An agent judgment is a candidate: the
   memory agent may decline it as a duplicate or as low value, it starts with lower importance,
   and consolidation archives it if it is never used. Saving everything the agent notices would
   repeat the error propagation that selective addition avoids (2505.16067).

   Background extraction (below) remains the safety net for what neither the user nor the agent
   flagged in the moment.

2. **Extraction.** The working agent sends an extraction job when it has been idle for a while
   (its alarm) and always before pruning. It does not touch Pi's compaction:
   1. The memory agent reads the entries after the checkpoint with its `read_entries` tool,
      which calls a paged RPC on the working agent's object (`scanEntries` inside).
   2. Extract candidate records with a configurable, cheaper model.
   3. Verify each candidate against the cited entries; drop unsupported ones.
   4. Reconcile with existing records in D1: add, supersede, invalidate, or skip (Mem0's
      ADD/UPDATE/DELETE/NOOP, but superseding instead of deleting).
   5. Advance the checkpoint in D1 in the same batch as the writes.
      Record IDs are content-addressed and writes use `INSERT OR IGNORE`, so a job that is
      interrupted and resumed writes no duplicates.
3. **Consolidation** at most about once a day, as a job the cron trigger sends to the memory agent,
   working over D1 instead of waking every agent (sleep-time compute; OpenClaw and Devin dreaming):
   merge duplicates, resolve contradictions, decay events, rebuild always-loaded blocks within
   budget with delta edits (never a full rewrite), induce skills, and prepare shared-memory
   proposals for review. It reads archived transcripts from R2 when it needs evidence. Extraction
   follows fixed steps in the prompt; consolidation uses the tool loop more freely, because it has
   to look for evidence and decide what to merge.

### Read paths

- Always-loaded blocks (above).
- `memory_search`: FTS5 BM25 in D1, ranked with recency and importance, with each record's
  provenance in the result.
- `history_search`: searches the `archive` event records (one summary per archived range) in
  D1, then reads that range from R2, whose key follows from the agent ID and the entry range.
  It is the safety net for details that extraction missed.

### Compaction

Compaction is Pi's job. Kodama keeps Pi's defaults and changes the policy in `src/harness.ts`
only if measurements call for it. If tool output later turns out to dominate the context,
observation masking through a `beforeRequest` hook is the first thing to try, before any change
to the summary.

### Reclaiming session storage: archive and prune

When storage fills up, the agent archives its oldest entries to R2 and deletes them. The
conversation, its active context, and the object stay as they are.

**What may be deleted.** Pi builds the model context only from the newest head marker onward:
after a compaction or reset, generation writes a fresh system entry with every section and tool
in effect (spec §2.1, rule 10). Entries before that head are read only by the history scan
`entries()`, which kodama does not use. So the prunable set is:

- entries of the root conversation whose ID is below the newest head (`P`);
- terminal task records, with their task-scoped documents and revisions;
- settled submissions older than the request-ID retention window (30 days by default);
- the `record_ids` rows of everything above.

Pi already keeps only the latest version of its own documents such as `pi.live`, so documents
need no pruning.

**When.** Only while the agent is idle (no live tasks), only while the root conversation is the
only conversation (kodama creates no others today; if it ever does, pruning skips), and when
`ctx.storage.sql.databaseSize` passes a threshold (for example 1 GB) or the prunable entries
pass a count. Deletes still succeed at the 10 GB limit (Durable Objects FAQ), so pruning can
recover an object that is already full.

**Steps**, run by the agent's own Durable Object:

1. If the extraction checkpoint is below `P - 1`, send an `extract` job up to `P - 1` and wait
   until it settles.
2. Export the entries from the last pruned ID to `P - 1` to
   `archive/<agentId>/<first>-<last>.jsonl` in R2, then write the chunk's manifest (range,
   counts, SHA-256, and the head marker's summary) and verify it. Exporting again writes the same
   keys, so a retry is harmless.
3. Send a `record_archive` job so the memory agent stores the summary as an `archive` event
   record for `history_search`.
4. Inside `blockConcurrencyWhile`: close the harness, delete the prunable rows in one
   `transactionSync`, record `P` as the pruned boundary in a small kodama table, reopen the
   harness, and refresh the recovery alarm.

The transaction is atomic and the export comes first, so a crash leaves either nothing deleted
or a complete, verified archive. The model context and `snapshot()` are the same before and
after; open `subscribe()` streams end when the harness closes and reconnect to the same state.

**Checked.** A workerd integration test (run once, not committed) sent three messages, compacted,
then deleted six of eight entries and all four terminal tasks. After eviction the agent answered
a new message, the model request contained the summary and none of the deleted text,
`snapshot()` showed the summary, the kept reply, and the new turn, and a retry of a pruned
turn's request ID returned its original submission without calling the model. In local workerd,
deleting 75% of a 20 MB table shrank `databaseSize` from 20.5 MB to 5.1 MB; production has not
been measured. Pruning old submissions has not been tested yet.

**Risk.** Pruning writes to Pi's internal tables, which are not a public API. Kodama pins the Pi
version, keeps pruning in one module, and runs a pruning test suite on every Pi upgrade
(continue the conversation, compact again, evict, recover from the alarm, cancel, deduplicate
request IDs, and compare snapshots). An official retention API in Pi Durable would replace the
module; kodama should propose one upstream. Until pruning ships, agents simply keep growing
toward the limit as they do today.

### Skills (procedural memory)

- **Format**: Agent Skills (`SKILL.md` with `name` and `description` frontmatter), compatible
  with Hermes, OpenClaw, and Claude Code.
- **Stores**: the index (name, description, scope, status, use count, R2 key) in D1; bodies and
  bundled files in R2.
- **Disclosure**: a prompt section lists at most a few dozen names and descriptions; the rest
  are found with `skill_search`. `skill_load` reads a body from R2.
- **Creation**: the memory agent, during consolidation, proposes a skill only from a
  procedure that succeeded at least twice, with the trajectories cited, and includes the
  failure lessons. A proposal becomes active after a replay or check passes; shared skills also
  need review. Working agents do not write skills, and nobody writes skills ahead of doing the
  work.
- **Curation**: stale after 14 days unused, archived after 30, pinned skills exempt, archived
  skills restorable, every change logged with its writer.

### Shared memory and safety

- Shared records are never written directly. The memory agent creates a pending proposal with
  provenance from agent-scope records that more than one agent relies on; a reviewer accepts or
  rejects it. Until there is a review UI, an operator RPC does this.
- Each shared record has one writer; updates create new versions instead of rewriting a block.
- Content from untrusted sources is stored as evidence with its source and is not promoted to
  always-loaded memory without review (OpenClaw does the same for untrusted reports).
- Never store secrets; redact before writing (Codex and Grok Build exclude secrets).

### Cost controls

- Raise `progress.partialIntervalMs` (for example to 500–1000 ms) after measuring rows per
  commit. The trade-off is coarser live streaming to the UI.
- Close `subscribe()` streams that nobody watches, or move observation to WebSocket hibernation.
- Prune before the session object grows large; archived bytes cost about 13 times less in R2.
- Give the memory agent a cheaper model; it does not need the working agents' model.
- Run consolidation as one job over D1 in the memory agent instead of waking every agent.

## Phases

Each phase ships with workerd integration tests that mock the model.

1. **Measure and reduce cost.** Set the progress interval explicitly; measure rows written,
   database size, and context size per turn.
   Tests: row counts per turn stay under a recorded budget.
2. **Long-term memory in D1 and the memory agent.** The schema as a D1 migration, the shared
   segmentation function with its version, `MemoryAgent` with its fixed configuration and tools,
   extraction and its checkpoint, `remember` with its immediate job, the read tools, and the always-loaded
   section.
   Tests: a `remember` call, from a user request or from the agent's own judgment, sends a job in
   the same turn and its record is in D1 before the agent goes idle; repeating the tool call creates
   no second submission; an agent-judged duplicate is declined; working agents have no
   memory-writing tools and `AgentService` cannot reach the memory agent; a fact stated before
   several compactions is found in D1 afterwards; a newer fact supersedes an older one; an
   interrupted extraction resumed writes no duplicates; a failed extraction leaves the checkpoint in
   place and the conversation unaffected.
3. **Archive and prune.** R2 export with manifests, the pruning module, `archive` records and
   `history_search`.
   Tests: after pruning, the conversation continues, compacts again, survives eviction and alarm
   recovery, and cancels; `snapshot()` is unchanged; request IDs inside the retention window stay
   deduplicated; rows are deleted only after a verified export; `databaseSize` falls. The suite
   runs again on every Pi upgrade.
4. **Skills.** D1 index, R2 bodies, disclosure, proposal from consolidation, curation.
5. **Shared memory.** Shared scopes, proposals from the memory agent, and review.
6. **Evaluation.** Probe questions after compaction and pruning (recall, artifacts,
   continuation, decisions, as in Factory's evaluation) and LongMemEval-style checks for
   knowledge updates, temporal questions, and abstention.

## Alternatives considered

- **Everything in Durable Objects** (a memory object per agent and per shared space). It works,
  but shared memory needs extra objects that stay awake, and the UI or maintenance jobs would
  wake those objects to read.
- **Never prune.** Simplest, and 10 GB is far for text-only chat. It still fails hard at the
  limit. Phases 1–2 work in this mode; pruning can wait until measurements call for it.
- **Wipe the object and restart from a handoff note** (in-place rotation, the previous version
  of this plan). It uses only public Pi APIs (`reset()` and `deleteAll()`), but it breaks the
  conversation's continuity, needs restore-from-manifest logic and a generation number, and
  drops every subscriber. It remains the fallback if a Pi change ever makes pruning unsafe.
- **Memory as markdown files in R2 only** (like OpenClaw and Hermes on disk). Cheapest storage
  and easy to edit by hand, but search needs a separate index and R2 has no transactions.
  Exporting D1 memory to markdown for people to read can be added later.
- **Each working agent writes its own memory** (the earlier version of this plan). It puts
  memory tools and instructions into every request, spends the working model on bookkeeping,
  and leaves several writers per scope. Letta abandoned this shape for the same reasons.
- **The memory agent as an `Agent` with a reserved ID** in the public namespace. It works, but
  every public RPC method would need to reject that ID, and tool restrictions would depend on
  configuration checks. A subclass with its own binding keeps both out of reach structurally.
- **The memory agent as a Cloudflare Workflow** (the previous version of this plan). Workflows
  are not billed while waiting on the model, but they would duplicate what `Agent` and Pi
  Durable already provide (durable admission, deduplication by request ID, a serial inbox,
  recovery) with a second execution model, its own tools, and its own tests. The saved
  duration is small (see the cost estimate above).
- **Own the compaction summary** through Pi's `beforeCompact` hook (extract memories and
  return an anchored summary). It couples memory to Pi's compaction task and makes kodama
  responsible for summary quality without evidence that Pi's summary is the problem. The hook
  stays available if evaluation probes show losses that memory and `history_search` cannot
  cover.
- **Wait for an official pruning API in Pi Durable.** The better end state: Pi knows its own
  invariants (entries are immutable and IDs are never reused; forks read their parents). Worth
  proposing upstream, not worth waiting for; kodama's pruning module is shaped so it can be
  swapped for such an API.
- **Cloudflare Agent Memory.** It matches this design closely and `cf` already has an
  `agentMemory` binding, but it is in private beta. Keep the memory store behind an interface
  so it can be swapped in later.

## Open questions

- Who reviews shared-memory proposals: a person through the UI, or the memory agent with
  stricter rules?
- How long must archived entries be kept, and who may delete them?
- Which model and budget should the memory agent use?
- How coarse may live streaming to the UI become in exchange for fewer writes?

## Sources

- Pi Durable 1.2.0 README and spec: https://github.com/earendil-works/pi/blob/main/packages/durable/docs/spec.md
- Durable Objects pricing, limits, FAQ, SQLite storage API: https://developers.cloudflare.com/durable-objects/platform/pricing/
- D1 pricing, limits, Time Travel, SQL statements (FTS5): https://developers.cloudflare.com/d1/platform/pricing/
- R2 pricing: https://developers.cloudflare.com/r2/pricing/
- OpenClaw memory, compaction, sessions: https://docs.openclaw.ai/concepts/memory
- Hermes Agent memory, sessions, skills, curator: https://hermes-agent.nousresearch.com/docs/user-guide/features/memory
- Grok Build memory: https://x.ai/news/grok-build-memory
- Cloudflare Agent Memory: https://blog.cloudflare.com/introducing-agent-memory
- Cloudflare Agents memory and sessions: https://developers.cloudflare.com/agents/concepts/memory/
- Letta shared memory: https://docs.letta.com/v1-sdk/memory/shared-memory
- Claude Code memory: https://code.claude.com/docs/en/memory
- Anthropic, effective context engineering: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Factory, evaluating compression: https://factory.ai/news/evaluating-compression
- Papers (arXiv): CoALA 2309.02427, MemGPT 2310.08560, Generative Agents 2304.03442,
  Mem0 2504.19413, Zep 2501.13956, ACE 2510.04618, Complexity Trap 2508.21433,
  rate–distortion compaction 2607.08032, survey 2603.07670, HaluMem 2511.03506,
  STALE 2605.06527, missing knowledge layer 2604.11364, Voyager 2305.16291, AWM 2409.07429,
  ASI 2504.06821, ReasoningBank 2509.25140, SkillsBench 2602.12670, SkillEvolBench 2605.24117,
  skills survey 2607.10113, Collaborative Memory 2505.18279, multi-agent memory 2603.10062,
  MINJA 2503.03704, MemoryGraft 2512.16962, MPBench 2606.04329, sleep-time compute 2504.13171
