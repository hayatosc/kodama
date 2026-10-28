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

## Daily usage reads

`AgentService.usage(actor, { agentId?, from, to, groupBy, cursor?, limit? })` accepts UTC dates
in an exclusive-end range of 1–366 days. `agentId` filters the charged UUID, not the executing
object. Group by `day`, `agent`, `credential` or `model`; group keys and continuation cursors
are JSON arrays. Pages default to 50 groups, at most 200. Like other management RPCs this is
private service-binding access for an active principal; finer roles remain separate work.
Pagination is key-ordered, not a frozen snapshot: refresh the query to see late ingestion.

Daily cron processes up to 20 registry objects, including archived and dedicated agents,
with a persistent round-robin cursor and up to five 20-record pages each. Individual failures
do not prevent other objects or consolidation from running. Export stops before an unfinished
invocation, even when later calls have finished. All bucket additions, credential last-use
updates and source-cursor advance share one atomic D1 batch guarded by its previous cursor.
Concurrent replay adds nothing twice; acknowledgment can be repeated after a lost response.

The reply separates reported and partial totals, unknown/not-applicable attempts, and optional
counter reporting counts. `payAsYouGoCatalogCostUsd`, `subscriptionApiEquivalentUsd` and
unattributed catalog amounts are never combined into a billing total. Usage days come from
invocation start, including when a response arrives after midnight. Stored catalog amounts
are not repriced against today's model catalog.

Freshness reports all registry sources, pending/unvisited/stale sources (26 hours), and the
oldest check timestamp. It is deliberately conservative even with an agent filter: another
object may charge that agent. It is not a live watermark. Large installations/backlogs can
take several daily sweeps; an incomplete or stale response must not be shown as measured zero.
`credentials.lastUsedAt` is the latest observed selected-credential invocation start, updated
by daily ingestion, not proof of a billable/accepted network request. Unknown outcomes count;
failures before selecting a credential do not.

## Retention and scope

Unaggregated invocation rows must never be deleted. Daily acknowledgment maintenance deletes
acknowledged details only after 30 days. Daily management totals and management audit rows
are retained indefinitely. There is no audit expiry, operation-receipt table or R2 audit export.

Subscription usage is an API-equivalent reference amount, separate from pay-as-you-go catalog
cost; neither implies subscription fees. No budgets, caps, reservations or cost-driven model
changes exist. Subscription limits never authorize falling back to an API key.
