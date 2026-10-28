# Usage accounting

## Invocation ledger

Each agent object records one `kodama_usage` row per outer Pi `streamSimple` invocation.
Pi's `completeSimple` uses this same boundary, including compaction. Separate Pi retries
and recovery invocations get separate monotonically increasing sequence numbers; provider
transport retries inside one stream do not. The event identity is the executing registry UUID
plus the local sequence. Terminal delivery is idempotent.

The intent is persisted before authentication and provider work. Credential selection records
only the actual credential UUID and kind, before releasing its secret. No content, raw provider
error, credential secret or transport payload is stored. A storage failure aborts the object
rather than being returned to Pi as a retryable provider failure. On reopening, remaining
in-flight rows become interrupted with unknown usage; this is not proof of zero cost.

Counters and catalog USD come from Pi's result at the time of the call. Reasoning tokens and
one-hour cache-write tokens are optional subsets, not additional tokens. Error/abort results
with counters are partial lower bounds. Missing/ambiguous all-zero measurements are nullable
unknown, not an estimated or measured zero. A failed invocation before credential selection
is marked not applicable. This is catalog accounting, not a provider invoice reconstruction.

## Attribution

- Working turns and compaction charge the working registry UUID.
- `contact_agent` is a peer call: the receiver pays, with actor `agent`.
- Memory `extract`, `remember` and `record_archive` charge the requesting/source UUID.
- Consolidation and unassigned memory maintenance charge the fixed memory UUID
  `00000000-0000-7000-8000-00000000000a`, actor `system`.

Memory jobs persist their accounting context before submission and restore it before resumed
requests. Each stream snapshots that context. A job cannot relinquish it or start the next
job until every Pi task, including background compaction, settles. When working admissions
mix user and peer input while busy, user attribution takes precedence. Actual parent/sub-agent
and working-agent scheduled execution do not exist yet and are not simulated here.

## Retention and scope

Unaggregated invocation rows must never be deleted. A later daily ingestion layer may delete
acknowledged details only after 30 days. Daily management totals and management audit rows
are retained indefinitely. There is no audit expiry, operation-receipt table or R2 audit export.

Subscription usage is an API-equivalent reference amount, separate from pay-as-you-go catalog
cost; neither implies subscription fees. No budgets, caps, reservations or cost-driven model
changes exist. Subscription limits never authorize falling back to an API key.
