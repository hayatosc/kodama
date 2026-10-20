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
  section changes also stay. Pi has no API to prune them.
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
   Durable Object is not more expensive than D1, but memory must outlive the session (the
   session object is wiped to reclaim storage), must be shared between agents, and must be
   readable by the UI and by maintenance jobs without waking agent objects. Each of these
   pushes memory into a separate store.

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
   compaction removes nothing from storage, so entries stay readable (`scanEntries`) until the
   session is rotated. Extraction can run in the background after the agent goes idle (like Grok
   Build and Hermes) and must run before rotation.
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
   change only at idle or rotation boundaries.
9. **Give memory its own writer.** Letta moved memory editing out of the conversing agent into
   a sleep-time agent, because bundling memory management with conversation made the agent
   slower and less reliable; the primary agent keeps only search tools. Cloudflare Agent Memory:
   "The primary agent should never burn context on storage strategy." Hermes can run its memory
   review on a cheaper model (about 3–5 times cheaper). A single writer also settles the
   consistency problem from finding 7.

## Design

### Storage layers

| Layer            | Store                                  | Contents                                                                                                         | Lifetime                    |
| ---------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Session          | the agent's Durable Object (unchanged) | Pi Durable session of the current generation; a frozen copy of the always-loaded memory; recent request receipts | one generation, then wiped  |
| Long-term memory | one D1 database `MEMORY_DB`            | memory records and their FTS5 index, shared-memory proposals, skill index and ledger, generation index           | kept                        |
| Archive          | R2 bucket `ARCHIVE`                    | transcripts of past generations (JSONL + manifest with SHA-256), skill bodies                                    | retention rule              |
| Memory agent     | Cloudflare Workflows `MemoryWorkflow`  | one run per job; durable step results                                                                            | per run                     |
| Optional         | Vectorize                              | embeddings of memory records                                                                                     | added only if search misses |

No new Durable Object classes are added. Agents read D1 and R2 through Worker bindings; only
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

### Record model

```text
memory_records(
  id            -- content-addressed: hash(scope, kind, key?, content)
  scope         -- agent:<id> | shared:<space>
  kind          -- fact | event | instruction | task
  key           -- normalized topic key for facts and instructions
  content
  provenance    -- JSON: agentId, generation, entry range, trigger, writer
                --   trigger: user_request | agent_judgment | extraction | consolidation
  observed_at, created_at
  superseded_by -- id of the record that replaced this one
  invalid_at    -- set when contradicted
  importance, use_count, last_used_at, pinned
)
memory_fts      -- FTS5 over content and key
```

Lifetimes by kind:

- **fact**: no decay. A new fact with the same key supersedes the old one and keeps the chain.
- **event**: ranked by recency (half-life configurable, 30 days by default, as in OpenClaw) and
  archived after the retention window.
- **instruction**: multi-step instructions become skill candidates during consolidation.
- **task**: dropped when done or at rotation, after the handoff note records open tasks.

Hard deletion is an operator action (privacy), not something the agent does.

### Always-loaded memory

A Pi prompt section renders capped blocks: the agent's notes and a small shared block. Each
block has a character budget shown in the prompt (Hermes shows `[67% — 1,474/2,200 chars]`).
The session object reads the blocks from D1 when a generation starts and when the memory agent
reports a finished run while the agent is idle, and keeps the rendered text in a Pi document.
Requests in between read that copy, so the prompt prefix stays stable and no request waits on
D1.

### The memory agent

Long-term memory has one writer: the **memory agent**. Working agents only read memory and ask
for things to be remembered.

- **What it is.** A Cloudflare Workflow (`MemoryWorkflow`), not a kodama agent. Each job is a
  fresh run with its own model configuration, usually a cheaper model than the working agents
  use. It keeps no conversation of its own, so it never needs compaction or rotation.
- **Why a Workflow.** Steps are durable and retried, so an interrupted job resumes without
  repeating finished steps. A Workflow waiting on a model response is not billed for CPU time,
  while a Durable Object waiting on the same response is billed for duration.
- **Runs do not conflict.** An extraction run's instance ID is derived from the agent ID and
  the checkpoint, and the checkpoint advances with a compare-and-set in D1, so two extraction
  runs never write the same range. Every run supersedes a record only with a compare-and-set
  on the record's current version, so a remember run and an extraction run cannot both replace
  the same fact.
- **Working agents keep a small tool surface**: `memory_search`, `history_search`,
  `skill_search`, `skill_load`, and `remember`. `remember` starts a memory-agent run at once;
  it does not write memory records itself.

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
   2. It creates a `MemoryWorkflow` instance right away, with the request and the IDs of the
      entries it came from. The instance ID is a hash of the agent ID, the source entry, and
      the content, so a tool call repeated after a restart cannot start a second run:
      Workflows rejects an ID that is still in use, and the tool treats that error as already
      started.
   3. It returns without waiting, so the turn is not held up and the session object is not
      billed for the memory agent's model time.
   4. The run classifies the request (usually an instruction or a fact), reconciles it with
      existing records (a new instruction supersedes the one it replaces), and writes it to
      D1. It is one small model call, not a scan of the transcript.
   5. The run then tells the session object that memory changed. The new block appears in the
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

2. **Extraction.** The session object starts a run when the agent has been idle for a while
   (its alarm) and always before rotation. It does not touch Pi's compaction:
   1. Read the entries after the agent's extraction checkpoint through a paged RPC on the
      session object, which uses `scanEntries`.
   2. Extract candidate records with a configurable, cheaper model.
   3. Verify each candidate against the cited entries; drop unsupported ones.
   4. Reconcile with existing records in D1: add, supersede, invalidate, or skip (Mem0's
      ADD/UPDATE/DELETE/NOOP, but superseding instead of deleting).
   5. Advance the checkpoint in D1 in the same batch as the writes.
      Record IDs are content-addressed and writes use `INSERT OR IGNORE`, so a run that is
      interrupted and repeated writes no duplicates.
3. **Consolidation** at most about once a day, as a scheduled run over D1 rather than inside
   agent objects (sleep-time compute; OpenClaw and Devin dreaming): merge duplicates, resolve
   contradictions, decay events, rebuild always-loaded blocks within budget with delta edits
   (never a full rewrite), induce skills, and prepare shared-memory proposals for review. It
   reads archived transcripts from R2 when it needs evidence. Extraction is a fixed pipeline;
   consolidation is where the memory agent needs a tool loop, because it has to look for
   evidence and decide what to merge.

### Read paths

- Always-loaded blocks (above).
- `memory_search`: FTS5 BM25 in D1, ranked with recency and importance, with each record's
  provenance in the result.
- `history_search`: searches the generation index (handoff notes and summaries) in D1, then
  reads the matching archived transcript from R2. It is the safety net for details that
  extraction missed.

### Compaction

Compaction is Pi's job. Kodama keeps Pi's defaults and changes the policy in `src/harness.ts`
only if measurements call for it. If tool output later turns out to dominate the context,
observation masking through a `beforeRequest` hook is the first thing to try, before any change
to the summary.

### Reclaiming session storage: in-place rotation

Pi cannot delete entries, so the session object is wiped and restarted from a handoff note.
Because long-term memory lives in D1, rotation keeps the same object and the same agent ID;
no routing layer is needed.

Rotation runs only when the session is idle and when one of these is true:

- `ctx.storage.sql.databaseSize` passes a threshold (for example 1 GB);
- the number of compactions in the generation passes a limit, so the next generation starts
  from curated memory instead of a long chain of summaries;
- a natural boundary, such as a long idle period (Hermes recommends `/new` at boundaries).

Steps, with progress recorded in the D1 generation index so a restart can resume:

1. Save the agent configuration and mark generation N as exporting.
2. Start a memory-agent run up to the last entry and wait for it to finish.
3. Export generation N to R2 in pages, write the manifest, and verify counts and hashes.
4. Store the handoff note (Pi's latest compaction summary plus open tasks) in the generation
   index.
5. Inside `blockConcurrencyWhile`: close the harness, call `ctx.storage.deleteAll()`, reopen
   Pi, restore the configuration, start from the handoff note (`reset(handoff)`), write the
   recent request receipts, and re-arm the alarm (`deleteAll()` also removes the alarm at this
   compatibility date). Mark generation N+1 active.

If a message arrives before step 5, rotation is abandoned and retried later. Kodama keeps a
small receipts table of recent request IDs, so retries and `submission()` still resolve after
the switch. Subscribers see their stream end and reconnect; clients already accept a
replacement snapshot. Whether `deleteAll()` is billed per deleted row has not been verified;
rotating before the object grows large keeps that bounded either way.

### Skills (procedural memory)

- **Format**: Agent Skills (`SKILL.md` with `name` and `description` frontmatter), compatible
  with Hermes, OpenClaw, and Claude Code.
- **Stores**: the index (name, description, scope, status, use count, R2 key) in D1; bodies and
  bundled files in R2.
- **Disclosure**: a prompt section lists at most a few dozen names and descriptions; the rest
  are found with `skill_search`. `skill_load` reads a body from R2.
- **Creation**: the memory agent, during consolidation, proposes a skill only from a procedure that succeeded at least
  twice, with the trajectories cited, and includes the failure lessons. A proposal becomes active
  after a replay or check passes; shared skills also need review. Working agents do not
  write skills, and nobody writes skills ahead of doing the work.
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
- Rotate before the session object grows large; archived bytes cost about 13 times less in R2.
- Run the memory agent as a Workflow: waiting on its model costs no CPU time, while the same
  wait inside a Durable Object is billed as duration.
- Run consolidation as one scheduled job over D1 instead of waking every agent.

## Phases

Each phase ships with workerd integration tests that mock the model.

1. **Measure and reduce cost.** Set the progress interval explicitly; measure rows written,
   database size, and context size per turn.
   Tests: row counts per turn stay under a recorded budget.
2. **Long-term memory in D1 and the memory agent.** Schema and migrations, `MemoryWorkflow`
   with extraction and its checkpoint, `remember` with its immediate run, the read tools, and
   the always-loaded section.
   Tests: a `remember` call, from a user request or from the agent's own judgment, starts a run
   in the same turn and its record is in D1 before the agent goes idle; repeating the tool call
   starts no second run; an agent-judged duplicate is declined; a fact stated before several
   compactions is found in D1 afterwards; a newer fact
   supersedes an older one; an interrupted extraction repeated writes no duplicates; a failed
   extraction leaves the checkpoint in place and the conversation unaffected.
3. **In-place rotation.** R2 export, the generation index, `history_search`, receipts.
   Tests: rotation survives eviction at every step; request IDs stay deduplicated across the
   switch; storage is wiped only after a verified export.
4. **Skills.** D1 index, R2 bodies, disclosure, proposal from consolidation, curation.
5. **Shared memory.** Shared scopes, proposals from the memory agent, and review.
6. **Evaluation.** Probe questions after compaction and rotation (recall, artifacts,
   continuation, decisions, as in Factory's evaluation) and LongMemEval-style checks for
   knowledge updates, temporal questions, and abstention.

## Alternatives considered

- **Everything in Durable Objects** (a memory object per agent and per shared space). It works,
  but memory dies with a wiped session unless copied out, shared memory needs extra objects
  that stay awake, and the UI or maintenance jobs would wake those objects to read.
- **Keep one session object forever.** Simplest, and 10 GB is far for text-only chat. It still
  has no way to free storage, keeps drifting summaries, and fails hard at the limit. Phases 1–2
  work in this mode; rotation can wait until measurements call for it.
- **Memory as markdown files in R2 only** (like OpenClaw and Hermes on disk). Cheapest storage
  and easy to edit by hand, but search needs a separate index and R2 has no transactions.
  Exporting D1 memory to markdown for people to read can be added later.
- **Each working agent writes its own memory** (the earlier version of this plan). It puts
  memory tools and instructions into every request, spends the working model on bookkeeping,
  and leaves several writers per scope. Letta abandoned this shape for the same reasons.
- **The memory agent as a kodama agent** (a Durable Object with its own Pi session). It would
  accumulate its own transcript, need its own rotation, and bill duration while it waits on the
  model. Nothing in its job needs a long-lived conversation.
- **Own the compaction summary** through Pi's `beforeCompact` hook (extract memories and
  return an anchored summary). It couples memory to Pi's compaction task and makes kodama
  responsible for summary quality without evidence that Pi's summary is the problem. The hook
  stays available if evaluation probes show losses that memory and `history_search` cannot
  cover.
- **Ask Pi Durable for pruning.** Deleting entries before the active head would conflict with
  Pi's immutable-entry invariant and fork semantics. Worth raising upstream, not worth waiting
  for.
- **Cloudflare Agent Memory.** It matches this design closely and `cf` already has an
  `agentMemory` binding, but it is in private beta. Keep the memory store behind an interface
  so it can be swapped in later.

## Open questions

- Who reviews shared-memory proposals: a person through the UI, or the memory agent with stricter rules?
- How long must archived transcripts be kept, and who may delete them?
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
