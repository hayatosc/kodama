# Long-term memory: rationale

Status: proposal.
The design itself is in [long-term-memory.md](long-term-memory.md). This document records, decision
by decision, what the design takes from existing systems and papers and what it rejects.
A Japanese version is in [long-term-memory-rationale.ja.md](long-term-memory-rationale.ja.md).

Some reasons rest on outside evidence (an existing system or a paper); others rest only on kodama's
own constraints. The latter are marked "kodama constraint".

## Premises

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

## Existing systems

| System                                 | Always-loaded memory                                                   | Searchable memory                                       | Write trigger                                                                          | Old history                                                              | Skills                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| OpenClaw                               | `MEMORY.md`, `USER.md`                                                 | daily notes, hybrid BM25 + vector, recency decay        | agent writes; silent "memory flush" turn before compaction; daily "dreaming" promotion | transcript kept on disk; `session.maintenance` prunes after 30 days      | not checked                                                                                      |
| Hermes Agent                           | `MEMORY.md` (2,200 chars), `USER.md` (1,375 chars), frozen per session | `session_search` over SQLite FTS5                       | memory tool; background review after turns                                             | compaction starts a continuation session; `prune` deletes ended sessions | project, local, and external directories; higher precedence shadows the same name; curator       |
| Grok Build                             | per-project and global markdown topics                                 | topic files read on demand                              | background capture after every turn; `/dream` merges                                   | not documented                                                           | not documented                                                                                   |
| Cloudflare Agent Memory (private beta) | none                                                                   | facts, events, instructions, tasks; FTS + vectors + RRF | bulk ingestion at compaction; `remember` and `forget` tools                            | raw messages kept; facts superseded, not deleted                         | not documented                                                                                   |
| Letta                                  | memory blocks                                                          | archival memory                                         | memory tools; sleep-time agent                                                         | git-backed memory repositories, shareable across agents                  | not checked                                                                                      |
| Pi                                     | none                                                                   | none                                                    | none                                                                                   | entries never removed                                                    | global and project directories; the first discovered skill wins a name collision, with a warning |

All of them keep procedures apart from facts as **skills**: name and description in the prompt,
body loaded when relevant (Anthropic's progressive disclosure). Claude Code: "If an entry is a
multi-step procedure … move it to a skill." Hermes: for something needed on every run of a
recurring task, a skill "is often the better home than a memory entry".

## Decisions

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

| Cost source                                                                                                              | Estimate                   | Lever                            |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------- | -------------------------------- |
| Pi progress commits while streaming: at most one commit per 100 ms (`progress.partialIntervalMs`), at least one row each | ≥ 8.6 million rows, ≥ $8.6 | raise the interval               |
| Duration while waiting on the model                                                                                      | 108,000 GB-s, $1.35        | unavoidable while the model runs |
| An open `subscribe()` stream all day (no hibernation)                                                                    | 324,000 GB-s, $4.05        | close streams nobody watches     |
| 1 GB of transcript kept in the object                                                                                    | $0.20 per month            | archive to R2 ($0.015)           |

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
their summary is stored as an `archive` record, and then the rows are deleted from the Durable
Object. The object is never wiped.

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

**Rejected.**

- **Never prune.** Simplest, and 10 GB is far for text-only chat. It still fails hard at the limit.
  Phases 1–2 work in this mode; pruning can wait until measurements call for it.
- **Wipe the object and restart from a handoff note.** It uses only public Pi APIs (`reset()` and
  `deleteAll()`) and resembles Hermes starting a continuation session at each compaction. It breaks
  the conversation's continuity, needs restore-from-manifest logic and a generation number, and
  drops every subscriber. It remains the fallback if a Pi change ever makes pruning unsafe.
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
through the `MEMORY_AGENT` binding. `AgentService` cannot reach it.

**Reasons (kodama constraint).**

- `Agent` and Pi Durable already provide durable admission, deduplication by request ID, a serial
  inbox, and recovery. Memory jobs use them as they are.
- A subclass with its own binding makes two things structural: public RPC cannot reach it, and its
  tools live in a separate registry.

**Rejected.**

- **A Cloudflare Workflow.** Workflows are not billed while waiting on the model, but this would
  rebuild what `Agent` already provides with a second execution model, its own tools, and its own
  tests. The saved duration is small (waiting costs $1.35 a month in the estimate of decision 1).
- **An `Agent` with a reserved ID in the public namespace.** Every public RPC method would need to
  reject that ID, and tool restrictions would depend on configuration checks.

### 6. Three write paths: `remember` in the turn, extraction when idle, daily consolidation

**Decision.**

- When the user asks, or the agent judges something worth keeping, the agent calls `remember` in
  the turn and the memory agent writes it right away.
- When the agent has been idle for a while, and before pruning, the memory agent extracts from the
  transcript.
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

**Decision.** Records are `fact`, `instruction`, `event`, or `task`. Facts and instructions carry a
topic key, and a newer record with the same key supersedes the older one. Events are ranked down by
recency.

**Reasons.**

- The four kinds and topic-key supersession (marked `superseded`, not deleted) follow Cloudflare
  Agent Memory.
- Mem0 (2504.19413) chooses ADD, UPDATE, DELETE, or NOOP for each candidate. Step 4 of extraction
  (add, supersede, invalidate, or skip) is the same choice.
- Applying time decay to facts is a category error (2604.11364). Zep (2501.13956) handles outdated
  facts with edge invalidation. Events do decay with recency (Generative Agents, 2304.03442, decay
  factor 0.995).
- Models accept stale facts (STALE, 2605.06527: 55.2% accuracy), so supersession is explicit.

**Rejected.**

- **A per-person scope** (Hermes's Honcho keeps a separate peer profile per counterpart). Kodama
  constraint: memory of the people an agent talks to is not needed.

### 8. Always-loaded memory is small, frozen, and changed only at idle boundaries

**Decision.** Always-loaded memory fits 2,200 characters for the agent and 1,000 for the shared
block. The agent object keeps a copy and refreshes it at start and on a change notice while idle.

**Reasons.**

- Hermes caps `MEMORY.md` at 2,200 characters and freezes it at session start to keep the prompt
  cache.
- Pi re-sends a changed section as a new system entry. Changing it mid-turn would cost a write and a
  cache miss each time.
- The budget display (`[67% — 1,474/2,200 chars]`) follows Hermes.

### 9. Search starts with D1 FTS5 and Intl.Segmenter

**Decision.** Text segmented with `Intl.Segmenter` is indexed by FTS5 (`unicode61 remove_diacritics
2`), ranked by BM25, and reranked by recency and importance. Vector search is not in the first
version.

**Reasons.**

- Hermes's `session_search` is SQLite FTS5. OpenClaw's built-in search starts from SQLite BM25 and
  adds vectors only when an embedding provider is configured.
- The survey 2603.07670 recommends starting simple and instrumenting.
- Japanese full-text search on D1 with FTS5 and `Intl.Segmenter` has been built before (coji on
  Zenn).
- `Intl.Segmenter` gives the same result in workerd as in Node. These queries all matched:
  「使う」, 「リポジトリ」, 「リポ」, 「デプ」, 「マネージャー」, 「レビュー」, 「サーバレス」 and
  「サーバーレス」, 「ベストプラクティス」, and 「ＰＮＰＭ 使う」.

**Rejected.**

- **FTS5's trigram tokenizer.** Trigram needs queries of at least three characters, so two-character
  words such as 「使う」 and 「リポ」 do not match. Its index is built per character position and is
  larger. `unicode61` alone treats a Japanese sentence without spaces as one token.
- **Vectors and RRF from the start** (Cloudflare Agent Memory, OpenClaw hybrid search). Start with
  full-text search, measure what it misses, then decide whether to add vectors.

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
- A skill starts as an agent skill and is promoted to a shared skill through review when two or
  more agents have the same procedure.
- A shared skill changes only through an accepted proposal.
- Each version has its own R2 directory.
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
- Promotion goes through review for the same reasons as shared memory (decision 13). Implanted
  "successful experiences" persist (MemoryGraft, 2512.16962), which makes shared skills especially
  risky. Collaborative Memory (2505.18279) also uses a write policy to place fragments in private or
  shared tiers, with immutable provenance.
- Success of the same procedure in two or more agents is evidence that it is not one agent's quirk.
  This applies decision 11's "verified experience" across agents (kodama constraint).
- Separate version directories keep a new version from replacing files of a skill that is being
  read (kodama constraint).
- Shared skills are kept longer because they passed review and serve several agents. Hermes's
  curator by default curates only agent-created skills, because bundled skills disappearing silently
  looks like a broken install. Kodama curates shared skills too, with twice the window, and archived
  skills can be restored (kodama constraint).
- A per-agent override wins only for that agent, like a Hermes project skill. When several agents
  override a shared skill the same way, that becomes evidence for an update proposal (kodama
  constraint).

**Rejected.**

- **Shared skills only** (one list for all agents). A procedure that succeeded in one agent would
  reach every agent, against decision 11, and the list would grow with the number of agents.
- **Agent skills only.** Each agent would relearn the same procedures, and improvements would not
  be shared.

### 13. Shared memory is written through review, with provenance

**Decision.** Shared scopes are written only when a proposal from the memory agent is accepted by
review. Accepted proposals become new record versions; shared records are not rewritten in place.
Content from untrusted sources is stored as an `event` with its source and never pinned without
review. Secrets are redacted before any write.

**Reasons.**

- Any user can inject memory (MINJA, 2503.03704).
- Prompt-injection defenses do not cover memory poisoning (MPBench, 2606.04329).
- Multi-agent memory consistency is the most pressing open challenge and needs structured memory
  access control (2603.10062).
- Collaborative Memory (2505.18279) splits memory into private and shared tiers, builds each
  agent's view with read and write policies, and keeps immutable provenance.
- OpenClaw: a report from an untrusted source is not stored as durable memory until a trusted
  reviewer confirms it.
- Hermes scans memory entries for injection and exfiltration patterns before accepting them.
- Cloudflare Agent Memory shows memory profiles shared across agents and people, so sharing itself
  is an ordinary shape.

## Weak points

To check before the design is settled:

- **Whether production `databaseSize` falls after pruning** is not verified. Locally it fell from
  20.5 MB to 5.1 MB.
- **Whether pruning old `submissions` is safe** is not verified.
- **Rows written per progress commit** are not measured (phase 1). The cost estimate of decision 1
  assumes one row, a lower bound.
- **A known search miss:** 「プラクティス」 alone does not match 「ベストプラクティス」.
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
