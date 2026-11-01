# Agent extensions

## Shared contracts

The shared foundation reserves object-local storage and transport contracts for three independent
features. It does not enable tools, expose new RPC methods, or schedule new alarms by itself.
`packages/agents/src/extensions.ts` is the pure contract module; `src/protocol.ts` re-exports its
transport types. `src/validation.ts` supplies strict binary upload and bounded list schemas.

- **Artifacts** store arbitrary bytes in R2 and object-owned metadata in SQLite. A file's extension
  or media type is not a storage allowlist. Parsing, previewing, and model image input are separate
  capabilities. Metadata references never grant access. Initial limits are 10 MiB per artifact,
  four output files per code execution, and 30-day retention. The code adapter must also cap total
  input and output bytes at 10 MiB each, not merely individual files.
- **Contacts** persist a sender outbox before dispatch and a receiver receipt before pruning Pi
  history. A result is not admission: terminal outcomes are succeeded, failed, cancelled, or
  unanswered. Pending work has no terminal expiry. Retained answer text is limited to 64 KiB of
  UTF-8, with explicit truncation and optional artifact references; those references do not imply
  that a recipient can read another object's files. Completed results default to 30-day retention.
- **Notifications** are agent-wide, not user-specific. They retain a bounded summary and a result
  reference rather than copying a complete answer or a file. Summaries are at most 2 KiB of UTF-8;
  notifications default to 30-day retention. Reads use descending sequence pagination. Marking a
  notification read does not delete its referenced result. Expired references must be explicit.

Generated schema changes live in `drizzle/durable-object/migrations/`; never hand-edit them.
`artifacts`, `contactRequests`, `contactReceipts`, and `notifications` are local to the owning DO.
No new DO class, D1 binding, public HTTP endpoint, or credential fallback is needed.

## Completion and notification atomicity

`src/agent/local-db/notifications.ts` exports `recordNotification(db, notice, now)`. Producers pass
an existing SQLite transaction so that terminal state and its notification commit together. The
first `(source, sourceId)` wins, regardless of later summary or outcome changes. This is a terminal
completion contract, not a generic mutable event feed. A replay never resets acknowledgement.

Source IDs are the sender's contact ID or the scheduled occurrence ID, not a schedule definition
ID. Notification insertion is not an instruction, does not start a model, and does not confer
owner authority. The caller derives provenance and content from persisted state, never model
arguments. Do not persist credentials or raw provider failures in notification summaries.

Across objects, use stable request identity, durable sender progress, and receiver receipts.
Persist the result and local notification before acknowledging receipt. Network delivery may
repeat; observable completion must not. Receiver admission and receipt creation must remain
recoverable if the object stops between them. Preserve existing request deduplication and hop
limits. An unacknowledged result cannot be silently pruned into a successful empty answer.

Retention must keep deduplication evidence until the producer can no longer replay completion.
Deleting old notification rows alone is not sufficient: coordinate cleanup with retained terminal
producer state, or ensure producers only insert on the first atomic terminal transition. Never
reconcile every historical terminal row into a newly created notification on each wake.

## Parallel implementation ownership

All feature branches start from the shared foundation on main, and target main with independent
PRs. Changes to shared composition files should be small, additive, and clearly identified in the
PR; do not reformat or restructure unrelated code. This foundation adds no speculative runtime
hooks: each branch connects its own implementation in the existing composition boundary.

### A: artifacts

Own `src/artifacts/`, `src/agent/local-db/artifacts.ts`, `src/tools/artifacts.ts`, and the file adapter
in `src/tools/code/execute.ts`. Wire artifact RPC and tools in the composition files. Use an
agent-scoped `artifacts/` prefix in the existing ARCHIVE bucket, isolated from archive retention.
Reserve metadata before upload, mark ready only after R2 succeeds, and make deletion and orphan
cleanup retryable. Never pass R2 bindings, credentials, arbitrary fetch, or a persistent filesystem
to generated Workers. Preserve existing JSON code input/output when no files are specified.
Download is binary by default; HTML must not execute merely because it was retrieved. Add binary
round-trip tests, code input/output tests, limits, ownership checks, and interrupted upload cleanup.

### B: tracked contacts

Own `src/agent/contact.ts`, `src/agent/local-db/contacts.ts`, and `src/tools/contact.ts`, plus necessary
registry discovery. Preserve immediate answers and the existing 30-second wait. Add contact IDs,
list/status/result tools, and recoverable result collection. Use description/labels for discovery,
without exposing credentials or unrelated settings. Capture replay identity from the actual Pi
execution, not model-supplied provenance. Use `recordNotification` when settling an outbound
contact. No dependency on C's public inbox API is required. Keep result retrieval and receipt
acknowledgement internal to validated peer operations; arbitrary caller-supplied sender IDs are
not authorization. Add stop/retry/pruning/hop tests. Do not add dynamic agents or use whole-agent
cancellation to cancel one peer request.

#### Implemented contact protocol and limits

`contact_agent` remains opt-in with the same `target`/`message` arguments and immediate 30-second
answer observation. Its response now includes a stable `contactId`; `list_contacts`, `contact_status`,
`contact_result`, and `discover_agents` are separately opt-in tools. Result reads are local and do not
resend the message. Discovery projects only active working agents' public metadata, matches descriptions
or names by text and labels exactly, and returns a scan cursor even when a filtered page is empty.

The sender reserves `contactRequests` from the actual adopted tool task and full durable input set.
It persists the bounded hop before dispatch; model-supplied sender or task identities are not accepted.
The receiver calls the registered sender object to verify the exact outbox and target, reserves a
`contactReceipts` pruning fence, and admits the stable Pi request. A receipt with `submissionId = 0`
means admission must be recovered by that request ID. Recovery checks an existing acceptance before
applying today's admission restrictions. Before any new admission it rechecks sender permissions,
receiver lifecycle, and credentials. No whole-agent cancellation is used for peer work.

Receiver reconciliation saves the exact terminal answer before Pi pruning; absent answer evidence
becomes explicit `unanswered`, never a successful empty answer. The sender commits its first terminal
result and notification together, then acknowledges the receiver. Stops before/after admission,
receipt persistence, sender completion, and acknowledgement can all replay without new delivery or
notification. The existing `contact` alarm purpose owns dispatch, collection, acknowledgement retries,
and result expiry; a slow or cancelled observer is not the recovery mechanism.

There are at most 100 pending outbound contacts per agent. Alarms process at most ten due contacts
per wake with a five-second total peer-observation budget, allowing later due purposes to run. Each
single-flight collection has a shared 30-second observation deadline, independent of the tool's
30-second wait. Accepted pending work is polled every minute and transport failures or attempt
timeouts back off up to one hour. A timeout means unknown acceptance, never a terminal refusal.

A timed-out collection keeps its exclusive slot until the underlying RPC chain actually settles;
re-observation cannot create overlapping retries or discard late success. Late answers follow the
same atomic result/notification, acknowledgement, and RPC-result disposal order. At most ten unresolved
flights are retained per object, including blocked acknowledgements; other work is deferred without
shortening backoff. A permanently stalled flight can pin its slot until completion or object restart.
After restart, the stable request ID and receiver receipt recover without duplicate admission.
The budgets bound peer observation, not platform storage latency or remote execution cancellation:
RPC disposal does not guarantee cancellation, and a scheduled retry cannot preempt Cloudflare's one
active alarm invocation per object. No scheduler purpose ordering or priority policy changes.
Results are capped at 64 KiB of UTF-8 without splitting code points, and terminal payloads expire after
30 days with explicit expiry in reads. Pending contacts and unacknowledged receiver answers never
expire. Replay tombstones and immutable request inputs are retained indefinitely; bounded cleanup of
that evidence is not implemented. Artifact reference arrays are currently empty; a peer reference
would not grant cross-agent artifact access. The legacy internal `sendTo` RPC stays admission-only.
No new public service-binding contact-result API is introduced.

### C: durable inbox

Own notification list/read/retention operations, the notification RPC/CLI, and scheduled completion
integration in `src/agent/scheduling.ts` and its store. Reuse `recordNotification`; do not create a
second contact tracker. Exercise the inbox using scheduled completion, independently of B.
Use exact sequence acknowledgements and bounded pagination. Add stop/retry/deduplication/unread
and schedule failure tests. Do not wake a model, inject owner messages, or add Slack/email delivery.

#### Inbox API and retention

`AgentService.notifications(agentId, { before?, unreadOnly?, limit? })` lists the admitted working
agent's inbox. The object-local method has the same name without `agentId`. Sequences sort in
**descending** order; `before` is exclusive. The default limit is 50, bounded to 1–100. A page returns
`{ notifications, nextBefore? }`; use `nextBefore` unchanged for the next page. Concurrent new
notifications do not shift an existing page cursor. Unread filtering uses the same sequence order.

`AgentService.readNotification(agentId, { seq })` marks exactly that sequence read, agent-wide.
It returns `true` for a live notification, including an already-read one, and `false` for a missing
or expired one. Replays preserve the first server-generated `readAt`; acknowledging one sequence
never acknowledges earlier sequences. Reads and acknowledgements are available for active,
pausing, paused and archived working agents, not unknown, dedicated, provisioning, deleting or deleted
agents. The authenticated calling Worker still owns user authorization; a source ID is not a capability.

Each item includes `referenceState`: `available` means its object-local terminal receipt is retained,
`expired` means the receipt is missing or past its retention deadline, and `unavailable` means a
receipt exists but has no terminal result. This is metadata availability, not authorization to read
an artifact or another agent's result. Schedule references identify occurrence receipts, not full
assistant answers; pruning Pi history does not turn them into retained answer text.

Scheduled execution success, model failure, global cancellation and other unanswered completions
produce one notification with a fixed, bounded summary. Raw provider errors, instructions and answer
text are not copied into it. Permanent pre-admission refusal or exhausted confirmed pre-admission
retries also produce a failure notice. Pending work and retries do not. Cancelling a definition only
stops future materialization: it does not itself produce a completion notice or cancel an admitted
execution. Accepted recurring execution failure/cancellation does not stop its future reservations.

The first atomic pending-to-terminal transition writes both the occurrence receipt and its notice.
Later settlement, acceptance repair and stale retries cannot revive terminal receipts. Thirty-day
notification retention removes inbox metadata, not referenced results. Reads opportunistically clean
expired metadata; the existing purpose-based `schedule` alarm also includes the earliest retained
notification expiry whenever scheduling is rearmed, without adding a platform alarm or model input.
Terminal receipt cleanup retains definitions and cursors. Even if inbox rows expire before receipt
cleanup, or both expire, a stale settlement cannot recreate the notice.

Local CLI commands return JSON through the existing token-authenticated development adapter:

```sh
nr agent notifications assistant --unread --limit 20
nr agent notifications assistant --before 42 --limit 20
nr agent notification-read assistant 41
```

Notification insertion alone is storage-only: contact producers use the shared transaction helper
and their existing wake/recovery path; they do not depend on this public API. There is no external
push delivery, model wake, owner-message insertion, per-user read state or complete schedule-answer
archive. Combined contact/artifact integration remains a separate validation step.

### Shared files and integration

`src/agent/agent.ts`, `src/index.ts`, `src/agent/config.ts`, `src/tools/index.ts`, `src/protocol.ts`,
`src/validation.ts`, `src/agent/runtime/alarms.ts`, and CLI composition may need additive changes in
more than one branch. Each branch owns only its feature's additions, preserves the other branches'
contracts, and reports conflicts. Do not merge other feature branches or push main. Do not create
competing platform alarms: extend the existing purpose-based scheduler. Do not alter shared
schemas or regenerate migrations in parallel without coordination; report a concrete missing
field to the coordinator first.

Each PR must pass `nr check` and, from `packages/agents`, `nr build`. PRs report remaining runtime
limits. Final combined validation additionally covers simultaneous scheduled/contact completion,
pruning with pending receipts, and artifact references that have expired or are unauthorized.
Review all PRs before merging; opening them does not imply the combined changes were validated.
