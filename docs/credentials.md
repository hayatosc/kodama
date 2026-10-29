# Credential operations

Provider credentials belong to the management D1 vault. The only Worker encryption secret is
`CREDENTIAL_KEK_V1`. The default `AgentService` uses the common registered-caller contract, including
registered agents; credential ownership is metadata, not an extra administration role. Results
contain metadata, fingerprints and last four characters only. Never paste secrets into a conversation,
configuration, shell argument or log. There is no public management HTTP endpoint.

Ownership is stored only as `owner_id`: NULL means installation, otherwise principal. Both outward
`ownerScope` and encryption AAD derive that scope from the ID. `lastUsedAt` is the latest start time
of a credential-associated outer model invocation, updated by daily usage ingestion; null means
none has been aggregated. It is not an exact per-HTTP-dispatch timestamp. Coverage reference versions come from the agent's current
version, not a second stored copy in the reverse index.

The schemas do not duplicate application invariants as SQL CHECK constraints. Primary keys,
foreign keys, uniqueness and required columns remain database constraints. Behavioral tests cover
complete encrypted-envelope writes, revocation cleanup and paired lease acquisition/release,
including expired leases and revocation during modification. Conditional updates and transactions,
not CHECK constraints, enforce concurrency control.

## Registration, assignment and revocation

Register credentials with `putCredential`, grant access with `grantCredential`, and select them with
`assignCredential` through a trusted private service binding. API keys and OAuth subscriptions use
the same encrypted storage and metadata-only results. OAuth access and refresh tokens are opaque,
strings with at least eight non-padding characters, an application policy rather than an RFC token-size rule. Metadata includes a last-four suffix only for tokens
with at least sixteen characters. The local CLI implements OAuth login through Pi; the credential
runtime refreshes ChatGPT tokens under D1-backed leases. There is no credential rotation RPC or
automatic reassignment workflow.

Unassignment removes an agent's grant and reference. Revocation affects all grants and atomically
clears the encrypted envelope and lease while appending audit. Metadata remains; no separate
revocation journal is written. Every read checks current status and grants, even with a warm
plaintext cache. Missing, revoked, unassigned and `needs_reauth` credentials stop with
`credential_unavailable`; expired OAuth credentials first attempt a lease-serialized refresh. No
alternate credential or environment key is tried. An already-running
provider request is not interrupted. Decrypted values are held only in the Durable Object's memory,
never persisted in plaintext or returned through RPC, and may remain until that instance is evicted.
Management changes invalidate the cache; every resolution still checks live D1 status, grants,
revision and OAuth expiry. Revoked or unassigned values are dropped as soon as detected and are
never served from a stale cache. Cross-object modifications acquire a 30-second D1 lease;
contending callers wait up to 30 seconds, honor cancellation, and recheck live permission before
acquiring the lease. The callback reads the newest committed value, so a concurrent OAuth refresh
can observe the first caller's update rather than refresh the same token twice.

## OAuth refresh contract

The runtime follows [RFC 6749 §§5.1, 5.2 and 6](https://www.rfc-editor.org/rfc/rfc6749.html),
Pi's bundled ChatGPT public-client flow, and OpenAI's
[token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference)
and [refresh error guidance](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery).
The [discovery document](https://auth.openai.com/.well-known/openid-configuration) confirms the token
endpoint, refresh grant, and support for public clients (`none` authentication).

Refresh uses a form-encoded POST to `https://auth.openai.com/api/accounts/oauth/token` with exactly
`grant_type=refresh_token`, the saved `refresh_token`, its saved issued `client_id`, and
`resource=https://api.openai.com/v1`. The resource field comes from Pi's endpoint-specific contract,
not RFC 6749 alone. No client secret, Authorization header, guessed client ID, or scope is sent.

A successful HTTP 200 response must contain an `access_token` meeting the eight-character minimum, case-insensitive Bearer
`token_type`, and positive finite `expires_in`. Expiry is required by this endpoint's documented
contract and Pi, although RFC 6749 only recommends the field. A returned `refresh_token` replaces
the old one; an omitted refresh token or unchanged scope retains its stored value, as allowed by
the RFC. Unrecognized response fields are ignored. The grant must still include
`chatgpt.tokens.use.direct`; expiry retains Pi's three-minute clock/network margin. Reads enter the
lease within Pi's five-minute preemptive window and recheck the current row after acquisition.

All six RFC token-error codes (`invalid_request`, `invalid_client`, `invalid_grant`,
`unauthorized_client`, `unsupported_grant_type`, `invalid_scope`) are terminal for an unchanged
request. OpenAI's `invalid_refresh_token`, `token_expired`, `refresh_token_expired`,
`refresh_token_invalidated`, and `refresh_token_reused` are also terminal. Both the RFC string
`error` and the provider-style `error.code` object are recognized. HTTP 401 is an authentication
failure; a bare or unrecognized HTTP 403 is not proof of invalid credentials. Network failures,
HTTP 429 and 5xx, unknown errors, and malformed success bodies preserve the stored credential rather
than guessing that it is invalid. They surface an unavailable error without an automatic retry loop.

Terminal failures atomically set `needs_reauth` and append `credential.needs_reauth` audit under the
live lease. Subsequent reads do not contact the token endpoint. The error carries structured
`code`, `status`, `provider`, `credentialId`, and `agentId` facts; command guidance belongs outside
the runtime. Client/request configuration errors require repair, not merely another login.

## Usage, audit and credential health

`AgentService.usage(actor, query)` reads daily catalog-priced USD, keeping pay-as-you-go cost separate
from subscription API-equivalent reference amounts. Unknown/partial measurements and daily freshness
are explicit; these are not provider invoices. See [Usage accounting](usage.md).

`AgentService.audit(actor, { targetId?, before?, limit? })` lists management events newest first.
`before` is an exclusive sequence cursor, default page size is 50, maximum 200. A returned
`nextCursor` continues the same target filter; null ends the current page sequence. Audit reads use
the same active registered-caller contract as other management methods, not per-owner ACLs, and do
not append audit events. Human/agent actions carry a principal ID; system actions carry null.
Registration, grant, assignment/unassignment, revocation and configuration events retain their
existing metadata-only detail. `credential.modify.attempt` denotes an attempted modification, not
proof that its refresh committed. No rotation/KEK-replacement events exist.

Credential summaries return health from D1 metadata only, without decrypting envelopes:

- `expiresAt`: effective OAuth expiry (including Pi's safety margin on refresh), null for API keys.
- `lastRefreshedAt`: most recent successful refresh CAS, not a refresh attempt; null before any success.
- `refreshFailures`: consecutive failed refreshes; a committed success resets it to zero.
- `lastRefreshFailureAt` and `lastRefreshFailureCategory`: latest failure history, retained after a
  later success. Categories are `rejected`, `transient`, `malformed`, or `failed`; never remote bodies.
- `status`: stored `active`, `revoked` or `needs_reauth`; active is not a claim that OAuth expiry is future.

Refresh health and failure audit commit together under the live lease/revision. Terminal rejection
uses one `credential.needs_reauth` event and one failure increment; other failed refreshes use
`credential.refresh.failed`. Canceled, stale, expired-lease or revoked writers cannot overwrite
health; a CAS conflict is not a provider failure. No-op reads do not update refresh health.

Management `audit_log` rows are retained indefinitely in D1, including the operation IDs used for
idempotent retries. There is no audit expiry, separate operation-receipt table, or R2 audit export.
Daily usage totals are also retained; only acknowledged local usage details are pruned, 30 days
after acknowledgment. Existing memory transcript archives are independent of this policy.

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
Inspect audit and coverage results. Audit detail excludes resolved credential values, but operation
IDs retain caller-supplied request IDs unchanged; never use a secret as a request ID.
Revoke exposed credentials; output filtering is not
part of the credential boundary. A combined leak of the KEK and D1 database is an accepted residual risk; no additional
mitigation will be pursued for that scenario, including a separate vault or split-key design.

## Leak-prevention boundaries

Outputs are not redacted. Credentials leave the store only for provider authentication, not as
model-visible context, tool results, responses, snapshots, or log fields. There is no output-scrubbing
wrapper and no in-memory set of secret values retained for redaction. This separation, rather than
inspection of response text, is the credential boundary.

Provider output streams normally without a redaction buffer. User and provider text, tool argument
keys, settings, and memory content are not rewritten based on either key shapes or credential values.
Request IDs retain their original identity subject to syntax and length validation, so retries,
lookup, and SSE agree. Do not paste secrets into conversations, settings, memory, or request IDs:
Kodama does not detect or remove secrets supplied as ordinary content, nor scrub a provider's
unexpected echo of authentication data.

Credential metadata APIs expose fingerprints and last4, never plaintext or encrypted envelopes.
Credential operation exceptions return fixed messages, and credential background logs retain error
categories rather than raw messages, causes, stacks, SQL bindings, or input secrets. Audit records
contain metadata only. Live D1 status and grant checks remain authoritative for every credential
resolution; removing response redaction does not weaken revocation or authorize credential access.

For local development, set a stable development KEK and run
`nr agent dev seed-credentials < /secure/path/provider-keys.json`.
Alternatively, register an API key with `nr agent credentials add --provider openai` using piped
stdin, or run `nr agent credentials login --provider openai` for ChatGPT OAuth. Registration/login
lazily initialize identity without creating agents. Pass the returned ID to
`nr agent seed --credential ID` and `nr agent create second --credential ID`; use
`credentials assign ID AGENT` only when changing an existing selection. The JSON object maps provider
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

## Native web-search authentication

Web search uses the applied conversation model and existing `credentials.primary[provider]`
assignment for `openai`, `xai`, `anthropic`, `deepseek`, or `google`. API keys retain kind `api_key`;
OpenAI subscription retains `oauth_subscription`. Other native subscription kinds are rejected,
not switched to another billing route. There is no search credential kind or ambient fallback.

An invocation-scoped D1 observer records credential UUID/kind in the existing usage row before
releasing plaintext. `Models.getAuth(model, {signal})` receives the tool's 15-second deadline,
including lease wait and refresh; restriction/cancellation checks run again before sending.
Native requests use fixed official endpoints, never Codex, proxies or identity impersonation.
API-key requests can incur both inference and search charges. Unknown costs remain null; there
are no budgets, billing approvals or failure-triggered anonymous fallbacks. Anonymous providers
receive no credentials/cookies, and fetch accepts no supplied authentication.
