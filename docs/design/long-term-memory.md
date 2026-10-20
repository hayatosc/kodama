# Long-term memory for long-running agents

Status: proposal. Nothing in this document is implemented yet.
A Japanese explanation is in [long-term-memory.ja.md](long-term-memory.ja.md).

Kodama agents are meant to run like an always-on bot: one agent keeps answering and working
in the same conversation for weeks or months. This document proposes how an agent remembers
what matters and lets go of the rest, so that neither its model context nor its Durable Object
storage grows without bound.

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
- **Summaries of summaries drift.** Pi summarizes the previous summary again together with the
  newer history (spec §8.7). Repeated lossy rewriting loses rare details ("summarization
  drift", arXiv 2603.07670), can collapse context abruptly (ACE, arXiv 2510.04618: 18,282 →
  122 tokens and accuracy below baseline), and loses more facts as compaction frequency rises
  when nothing reversible backs it (arXiv 2607.08032: recall 0.33–0.56 vs. about 0.95 with a
  retrievable archive).
- **One endless session is the worst case for learning.** Hermes Agent documents this for
  gateway chats: a single session "grows expensive (compaction runs repeatedly over an
  ever-longer history) and the learning loop … almost never gets to fire."

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
2. **Mask before summarizing.** Hiding old tool outputs matched LLM summarization at about half
   the cost on SWE-bench Verified, and summarization lengthened trajectories by 15%
   (2508.21433). OpenClaw's session pruning and Anthropic's context editing do the same.
3. **Merge summaries incrementally.** Anchored, sectioned summaries that merge only the newly
   cut span (Factory) and delta updates instead of full rewrites (ACE) avoid collapse.
4. **Extract memories at compaction time.** It is the last chance before detail leaves the
   context (OpenClaw memory flush, Cloudflare ingestion). Extraction and updating are where
   memory systems create and accumulate errors (HaluMem 2511.03506), so extracted items need
   verification against the transcript and provenance.
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
   change only at compaction or rotation boundaries.

## Design

### Memory scopes

| Scope       | Owner                                     | Contents                                                       | Writes                                        |
| ----------- | ----------------------------------------- | -------------------------------------------------------------- | --------------------------------------------- |
| **Context** | session (Pi)                              | current turns, compaction summary                              | Pi                                            |
| **Agent**   | `AgentHome(agentId)`                      | the agent's notes, learned conventions, episodes, its skills   | the agent; consolidation                      |
| **Peer**    | `AgentHome(agentId)`, keyed by peer       | what this agent knows about each person or agent it talks with | the agent; consolidation                      |
| **Shared**  | `MemorySpace(name)`, for example `global` | team conventions, shared facts, shared skills                  | proposals from agents, accepted by a reviewer |

Peer memory stays per agent by default, like Honcho's per-peer profiles, so one user's
statements do not leak into another user's context. A shared peer profile can come later with
explicit read and write policies (Collaborative Memory, arXiv 2505.18279).

### Record model

One table per store, plus an FTS5 index (SQLite FTS5 is available in Durable Objects; the
Cloudflare Agents SDK uses it):

```text
memory_records(
  id            -- content-addressed: hash(scope, kind, key?, content)
  scope         -- agent | peer:<id> | shared:<name>
  kind          -- fact | event | instruction | task
  key           -- normalized topic key for facts and instructions
  content
  provenance    -- JSON: agentId, epoch, entry range, peerId, tool, writer
  observed_at, created_at
  superseded_by -- id of the record that replaced this one
  invalid_at    -- set when contradicted
  importance, use_count, last_used_at, pinned
)
```

Lifetimes by kind:

- **fact**: no decay. A new fact with the same key supersedes the old one and keeps the chain.
- **event**: ranked by recency (half-life configurable, 30 days by default, as in OpenClaw) and
  archived after the retention window.
- **instruction**: multi-step instructions become skill candidates during consolidation.
- **task**: dropped when done or at rotation, after the handoff note records open tasks.

Hard deletion is an operator action (privacy), not something the agent does.

### Always-loaded memory

A Pi prompt section renders capped blocks: agent notes, the current peer's profile, and a small
shared block. Each block has a character budget shown in the prompt (Hermes shows
`[67% — 1,474/2,200 chars]`). The rendered text is a snapshot stored in a Pi document and
refreshed only after a compaction is placed or at rotation.

### Write paths

1. **Explicit tool** `memory` with `remember`, `update`, `forget`, and `search`. Input is
   validated with valibot, size-capped, and scanned for injection patterns before it is
   accepted.
2. **Pre-compaction flush** through Pi's `beforeCompact` hook, which receives the entries and
   messages about to be summarized:
   1. Extract candidate records with a configurable, cheaper model.
   2. Verify each candidate against the cited messages; drop unsupported ones.
   3. Reconcile with existing records: add, supersede, invalidate, or skip (Mem0's
      ADD/UPDATE/DELETE/NOOP, but superseding instead of deleting).
   4. Return an anchored summary: keep the previous summary's sections (intent, decisions and
      their reasons, artifacts touched, open tasks, constraints) and merge only the new span.
   5. If anything fails, return `undefined` so Pi's built-in compaction still runs.
      Hooks can run again after a restart, so record IDs are content-addressed and writes are
      idempotent; `api.memo` keeps the extraction result of one compaction task.
3. **Idle review and consolidation** on the home object's alarm, after the agent has been idle
   for a while and at most about once a day (sleep-time compute; OpenClaw dreaming; Devin
   dreaming): merge duplicates, resolve contradictions, decay events, rebuild always-loaded
   blocks within budget with delta edits (never a full rewrite), and propose skills.

### Read paths

- Always-loaded blocks (above).
- `memory_search`: FTS5 BM25 ranked with recency and importance, plus the record's provenance in
  the result. Vectors (Vectorize) are an optional later channel.
- `history_search`: searches archived epochs (see rotation) by their summaries and an FTS index
  of user and assistant text. It is the safety net for details that extraction missed.

### Context trimming

- Keep Pi compaction and set its policy explicitly in `src/harness.ts`.
- Add observation masking with a `beforeRequest` hook: replace tool results older than the last
  N tool rounds with a placeholder that keeps the tool name and a short head. Masking is
  positional and deterministic so the cached prefix stays stable. Storage is unchanged; the
  original result stays retrievable.

### Storage: epoch rotation

Pi cannot delete entries, so storage is reclaimed by moving the conversation to a fresh
object and deleting the old one, like Hermes' compaction lineage.

```text
AgentService (RPC entrypoint)
  └─ AgentHome(agentId)          config, current epoch, agent/peer memory, skills, archive index
       └─ AgentSession(agentId.N) Pi Durable session for epoch N (today's Agent class)
MemorySpace(name)                 shared memory and skills
R2 bucket ARCHIVE                 epoch transcripts: JSONL + manifest with SHA-256
```

The current `Agent` class becomes `AgentSession`. Epoch 0 keeps the existing object name
(`agentId`) so current agents migrate without copying. Later epochs use `agentId.N`; agent IDs
cannot contain `.`, so names never collide.

Rotation runs only when the session is idle and when one of these is true:

- `ctx.storage.sql.databaseSize` passes a threshold (default well under 10 GB, for example 1 GB);
- the number of compactions in the epoch passes a limit, to stop summary-of-summary drift;
- a natural boundary, such as a long idle period (Hermes recommends `/new` at boundaries).

Steps, recorded in `AgentHome` as a resumable state machine driven by its alarm:

1. Flush: run extraction over the span not yet flushed.
2. Write the handoff note: the latest anchored summary plus open tasks.
3. Create epoch N+1 with the stored configuration and start it from the handoff note
   (`reset(handoff)`), then switch the pointer in `AgentHome`.
4. Export epoch N to R2 in pages, write the manifest, and verify counts and hashes.
5. Index the epoch for `history_search`, then call `deleteAll()` on epoch N.

`AgentHome` buffers messages that arrive during steps 3–5 and keeps a short-lived map from
recent request IDs to their epoch, so retries and `submission()` still find their receipts.
Subscribers of epoch N see their stream end and reconnect; clients already have to accept a
replacement snapshot.

Archive retention is a configurable R2 lifecycle rule. Deleting an archive is a privacy delete;
compaction is not.

### Skills (procedural memory)

- **Format**: Agent Skills (`SKILL.md` with `name` and `description` frontmatter), compatible
  with Hermes, OpenClaw, and Claude Code.
- **Stores**: per-agent skills in `AgentHome`; shared skills in `MemorySpace`. Large bodies go
  to R2 (SQLite rows are limited to 2 MB).
- **Disclosure**: a prompt section lists at most a few dozen names and descriptions; the rest
  are found with `skill_search`. `skill_load` returns a body.
- **Creation**: consolidation proposes a skill only from a procedure that succeeded at least
  twice, with the trajectories cited, and includes the failure lessons. A proposal becomes active
  after a replay or check passes; shared skills also need review. The agent does not write
  skills ahead of doing the work.
- **Curation**: use counts; stale after 14 days, archived after 30, pinned skills exempt,
  archived skills restorable, every change logged with its writer.

### Shared memory and safety

- Agents never write shared records directly. `memory_propose` creates a pending record with
  provenance; a reviewer (an operator RPC, or a designated curator agent) accepts or rejects it.
- Each shared record has one writer; updates create new versions instead of rewriting a block.
- Content from untrusted peers is stored as evidence with its source and is not promoted to
  always-loaded memory without review (OpenClaw does the same for untrusted reports).
- Never store secrets; redact before writing (Codex and Grok Build exclude secrets).

### Protocol changes

Peer memory needs to know who is speaking. `SendMessageRequest` gains optional
`peer: { id, displayName? }` and `channel?` fields. The UI Worker or bot adapter sets them after
authenticating the sender; the agent never trusts a peer ID from message text. New RPC methods
cover memory inspection, export, deletion, proposal review, and rotation status.

## Phases

Each phase ships with workerd integration tests that mock the model.

1. **Measure and tune.** Configure compaction explicitly; report database size, entry count,
   and compaction count in the snapshot; add observation masking.
   Tests: masking leaves storage unchanged and keeps the prefix stable across requests.
2. **Agent memory.** Add `AgentHome` with `memory_records` and FTS5, the `memory` tool, the
   always-loaded section, and the `beforeCompact` flush with anchored summaries.
   Tests: a fact survives several compactions; a newer fact supersedes an older one; a failed
   extraction falls back to Pi's summary; a re-run hook writes no duplicates.
3. **Epoch rotation.** Route through `AgentHome`, add `AgentSession` epochs, R2 export, and
   `history_search`.
   Tests: rotation survives eviction at every step; request IDs stay deduplicated across the
   switch; old storage is deleted only after verified export.
4. **Skills.** Stores, disclosure, proposal from consolidation, curation.
5. **Shared memory and peers.** `MemorySpace`, proposals and review, peer-scoped memory, protocol
   fields.
6. **Evaluation.** Probe questions after compaction and rotation (recall, artifacts,
   continuation, decisions, as in Factory's evaluation) and LongMemEval-style checks for
   knowledge updates, temporal questions, and abstention.

## Alternatives considered

- **Keep one object forever.** Simplest, and 10 GB is far for text-only chat. It still has no
  way to free storage, keeps drifting summaries, and fails hard at the limit. Phases 1–2 work in
  this mode; rotation can wait until measurements call for it.
- **Ask Pi Durable for pruning.** Deleting entries before the active head would conflict with
  Pi's immutable-entry invariant and fork semantics. Worth raising upstream, not worth waiting
  for.
- **Cloudflare Agent Memory.** It matches this design closely (one Durable Object per profile,
  ingestion at compaction, supersession) and `cf` already has an `agentMemory` binding. It is in
  private beta. Keep the store behind an interface so a profile can back `MemorySpace` later.
- **Vector-first memory.** Embeddings help paraphrased queries, but FTS5 needs no extra service
  and keeps writes transactional. Add Vectorize after the probes show misses.

## Open questions

- Who reviews shared-memory proposals: a person through the UI, or a curator agent?
- How long must raw transcripts be kept, and who may delete them?
- Which model and budget should extraction and consolidation use?
- Should peer profiles ever be shared between agents, and with whose consent?

## Sources

- Pi Durable 1.2.0 README and spec: https://github.com/earendil-works/pi/blob/main/packages/durable/docs/spec.md
- Durable Objects limits and FAQ: https://developers.cloudflare.com/durable-objects/platform/limits/
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
