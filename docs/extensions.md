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

## Artifact operations

Artifacts are arbitrary bytes, not a format allowlist: PNG, ZIP, HTML, PDF, Office documents, and
unknown binary formats all use the same storage path. Their declared media type and filename are
untrusted labels. Storage support does not promise parsing, a preview, model image input, or that
an npm library can interpret a particular format.

The private `AgentService` RPC exposes `uploadArtifact(agentId, { filename, mediaType, bytes })`,
`listArtifacts(agentId, { cursor?, limit? })`, `downloadArtifact(agentId, artifactId)`, and
`deleteArtifact(agentId, artifactId)`. All use registered working-agent admission. Upload requires an
active agent; list/download/delete remain available while paused or archived. Metadata contains
`artifactId`, `filename`, `mediaType`, `size`, `createdAt`, and `expiresAt`, never an R2 key or a public
URL. List returns an array ordered by ascending artifact ID, defaults to 50 items, and accepts a
limit of 1–100; use the last returned ID as the next cursor. Downloads return metadata plus a
`Uint8Array`. A missing, expired, uploading, deleting, or another owner's ID cannot be downloaded.
Deleting an ID absent from the caller's local metadata, including another owner's ID, is an
indistinguishable no-op, not a cross-owner operation. If a local metadata row exists but its storage
key points outside the owner's prefix, download and deletion reject with `artifact_unavailable`
before accessing R2. This is an integrity failure, not an ordinary missing ID; the ownership check
is never bypassed.

With the local development Worker and an existing `assistant` agent:

```sh
nr agent artifacts upload assistant ./photo.png --media-type image/png
nr agent artifacts upload assistant ./bundle.zip --media-type application/zip
nr agent artifacts list assistant --limit 20
# This replaces the optional tool selection; include any other tools you wish to retain.
nr agent tools assistant execute_code list_artifacts delete_artifact
nr agent send assistant 'Use execute_code with files containing <artifact-id> to copy the selected file. Return its bytes as a new artifact named copy.png; do not parse the file.'
nr agent artifacts list assistant
nr agent artifacts download assistant <new-artifact-id> ./copy.png
nr agent artifacts delete assistant <artifact-id>
```

Uploads default to `application/octet-stream` when `--media-type` is omitted. Downloads require a
new path, use mode 0600, and refuse to overwrite existing files. The development-only, bearer-token
adapter streams uploads through a bounded binary multipart transport and returns every download as
`application/octet-stream`, with attachment disposition, `nosniff`, a sandbox CSP, and no-store.
Retrieving HTML never renders or executes it. Production remains private service-binding RPC with
no artifact HTTP endpoint; any future caller that serves bytes must preserve attachment safety.

`list_artifacts` and `delete_artifact` are optional working-agent tools, disabled by default and
subject to the current lifecycle, selected tools, and `toolPolicy`. They return metadata/status,
not previews. To transform files, opt into `execute_code` and supply only the selected artifact IDs:

```json
{
  "files": ["<artifact-id>"],
  "input": { "name": "copy.png" },
  "code": "export default (input, files) => ({ result: { copied: files.length }, files: files.map(file => ({ ...file, filename: input.name })) })"
}
```

In file mode, the default export receives `(input, files)` where each file has `filename`,
`mediaType`, and `bytes: Uint8Array`. It returns `{ result: JSON, files: [...] }`; omit output `files`
for no files, or use input `files: []` for output-only execution. The tool result is JSON text with
`result` and saved file metadata/IDs. No file bytes or storage bindings enter the model transcript.
Omitting the input `files` field preserves the original JSON-only execution API exactly.

Each artifact is at most 10 MiB and expires 30 days after upload. Each execution allows at most 100
selected IDs, no duplicate IDs, 10 MiB of aggregate input bytes, 10 MiB of aggregate output bytes,
and four output files. Host-side validation applies before saving any outputs. Multipart output
transport also allows at most 64 KiB beyond the byte limit for metadata and the JSON result, so
large file-mode JSON results can fail even when file bytes fit. Pi's existing tool-result text
truncation still applies to returned metadata/results. There is no per-agent storage quota or
format-specific parser. Platform CPU/memory limits and npm compatibility still apply.

The compiler is trusted and may resolve requested npm dependencies; generated code has no host
bindings, credentials, outbound network, or host/persistent filesystem. Both file and JSON-only modes
retain `nodejs_compat` and support Workers-compatible npm packages and Node built-ins. In particular,
`node:fs` and `node:fs/promises` can read the Worker's own read-only `/bundle` and use temporary
in-memory `/tmp` and virtual `/dev`, as described in Cloudflare's
[filesystem documentation](https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/).
This virtual filesystem does not mount Kodama host files or R2. Temporary files consume Worker
memory and are not artifacts: return their bytes explicitly to persist output. Only explicitly
selected artifact bytes enter the isolate. Every file execution uses a fresh Worker identity,
preventing module-global and temporary-file byte carryover across calls, while compiled source can
still be reused. The original JSON-only API and its cache behavior remain unchanged. File IDs are
owner-local references, not capabilities: sharing an ID in chat or a contact never grants another
agent access.

Metadata is reserved as `uploading` before R2 IO under `artifacts/<agent-id>/`, then made `ready`
only after R2 succeeds. Interrupted uploads remain hidden and are collected after a 60-second
grace period. Deletion hides the artifact first and retains a `deleting` row until R2 deletion
succeeds. The existing purpose-based alarm dispatcher retries cleanup after a stop or R2 failure;
cleanup processes at most 100 rows per pass and never scans or deletes archive segments. Expired
artifacts are inaccessible even before physical cleanup runs. Output saves are not a multi-file
transaction: a later failure attempts retryable deletion of already saved files; an ambiguous
upload response can leave a hidden reservation or a ready file discoverable through listing.
Interrupted execution is not automatically replayed, consistent with `execute_code`'s unsafe replay
policy. No new schema, bucket, binding, or credential fallback is introduced.

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

### C: durable inbox

Own notification list/read/retention operations, the notification RPC/CLI, and scheduled completion
integration in `src/agent/scheduling.ts` and its store. Reuse `recordNotification`; do not create a
second contact tracker. Exercise the inbox using scheduled completion, independently of B.
Use exact sequence acknowledgements and bounded pagination. Add stop/retry/deduplication/unread
and schedule failure tests. Do not wake a model, inject owner messages, or add Slack/email delivery.

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
