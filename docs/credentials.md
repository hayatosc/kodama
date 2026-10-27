# Credential operations

Provider credentials belong to the management D1 vault. The only Worker encryption secret is
`CREDENTIAL_KEK_V1`. The default `AgentService` uses the common registered-caller contract, including
registered agents; credential ownership is metadata, not an extra administration role. Results
contain metadata, fingerprints and last four characters only. Never paste secrets into a conversation,
configuration, shell argument or log. There is no public management HTTP endpoint.

Ownership is stored only as `owner_id`: NULL means installation, otherwise principal. Both outward
`ownerScope` and encryption AAD derive that scope from the ID. Usage timestamps are not tracked;
metadata retains `lastUsedAt: null`. Coverage reference versions come from the agent's current
version, not a second stored copy in the reverse index.

The schemas do not duplicate application invariants as SQL CHECK constraints. Primary keys,
foreign keys, uniqueness and required columns remain database constraints. Behavioral tests cover
complete encrypted-envelope writes, revocation cleanup and paired lease acquisition/release,
including expired leases and revocation during modification. Conditional updates and transactions,
not CHECK constraints, enforce concurrency control.

## Registration, assignment and revocation

Register credentials with `putCredential`, grant access with `grantCredential`, and select them with
`assignCredential` through a trusted private service binding. API keys and OAuth subscriptions use
the same encrypted storage and metadata-only results. OAuth access and refresh tokens must each
contain at least eight characters, both at registration and modification; shorter values are rejected
rather than ambiguously matched against protocol text. Metadata includes a last-four suffix only
for tokens with at least sixteen characters. OAuth login and refresh-provider integration
are separate work. There is no credential rotation RPC or automatic reassignment workflow.

Unassignment removes an agent's grant and reference. Revocation affects all grants and atomically
clears the encrypted envelope and lease while appending audit. Metadata remains; no separate
revocation journal is written. Every read checks current status and grants, even with a warm
plaintext cache. Missing, revoked, unassigned and expired credentials stop with
`credential_unavailable`; no alternate credential or environment key is tried. An already-running
provider request is not interrupted. Decrypted values are held only in the Durable Object's memory,
never persisted in plaintext or returned through RPC, and may remain until that instance is evicted.
Management changes invalidate the cache; every resolution still checks live D1 status, grants,
revision and OAuth expiry. Revoked or unassigned values are dropped as soon as detected and are
never served from a stale cache. Cross-object modifications acquire a 30-second D1 lease;
contending callers wait up to 30 seconds, honor cancellation, and recheck live permission before
acquiring the lease. The callback reads the newest committed value, so a concurrent OAuth refresh
can observe the first caller's update rather than refresh the same token twice.

## Worker Secret boundary

The Worker only reads `CREDENTIAL_KEK_V1` for encryption and decryption. It does not create, update,
or delete Worker Secrets or call Cloudflare's Secret management API. Secret provisioning belongs to
the operator outside the application. There is no KEK rotation, generation tracking, rewrapping,
old-key input, or fallback key resolution.

Changing or losing the KEK makes existing encrypted credentials unreadable. Re-register provider
credentials and assign the new records; there is no encrypted-data recovery or migration workflow.
Do not change the KEK as a routine application operation.

## Leak response

Revoke a leaked credential at the provider first, then revoke it in Kodama. Every credential
resolution checks live D1 state, so revoked rows cannot be selected even with a warm cache.
Inspect secret-free audit and coverage results. Redaction is defense in depth, not a substitute for
revocation. A combined leak of the KEK and D1 database is an accepted residual risk; no additional
mitigation will be pursued for that scenario, including a separate vault or split-key design.

## Leak-prevention boundaries

Configurations reject unknown fields and redact credential-shaped text before returning or storing
it. User input and provider output are redacted before Pi persistence; tool results are redacted
before committing their entries. Secret-bearing object keys are dropped, not renamed into colliding
keys. Credential-shaped request IDs are rejected rather than redacted so deduplication, lookup, and
SSE keep one stable identifier; admission also rejects IDs containing a known assigned secret.
Exact-value redaction knowledge also lives only in the object's memory until eviction, protecting
late provider responses even after a credential is invalidated. This lifetime retention is intentional:
the agents Worker has no public HTTP surface, and objects are reached only through private RPC
within the deployment. There is no five-minute plaintext-retention limit. The filter also recognizes
`sk-…`, `xai-…` and JWT shapes. Memory-record and skill writes apply the same pattern filter even
when called outside the model tool path. Credential operation exceptions return fixed messages,
and background logs retain error categories rather than raw messages, causes, stacks or SQL
bindings. Audit records contain metadata only.

A provider response is buffered until complete before emitting sanitized content. This intentionally
trades token-by-token streaming for preventing split credential values from leaking through SSE.
Lifecycle and completion events remain available. Redaction cannot recognize arbitrary secrets
that have never been registered or do not match a known pattern; never use conversations or memory
to transport keys, including encoded or transformed keys.

For local development, set a stable development KEK and run
`nr agent dev seed-credentials < /secure/path/provider-keys.json`. The JSON object maps provider
IDs (`openai`, `anthropic`, `google`, `xai`) to keys. The command reads stdin, uses the authenticated
localhost-only development adapter, registers encrypted rows, and assigns both agent kinds. Keep
the file outside the repository with mode 0600 and remove it after registration. The adapter and
its local registration adapter are absent from production; only private trusted RPC callers register
production keys. No provider environment variables or credential files are used for model auth.

## Operational policy

KEK loss does not require an elaborate backup-location or recovery-custody scheme. If the KEK is
lost, re-register the provider credentials rather than plan recovery of the encrypted values.
Backup location, custody/access rules and per-key usage limits are not outstanding policy decisions.
Kodama is not deployed; no legacy credential formats or provider-secret migration paths are supported.
