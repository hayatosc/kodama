# Credential operations

Provider credentials belong to the management D1 vault. The only Worker encryption secret is
`CREDENTIAL_KEK_V1`. The default `AgentService` uses the common registered-caller contract, including
registered agents; credential ownership is metadata, not an extra administration role. Results
contain metadata, fingerprints and last four characters only. Never paste secrets into a conversation,
configuration, shell argument or log. There is no public management HTTP endpoint.

## Credential replacement

1. Obtain replacement credentials from the provider; keep the previous credential valid during the
   transition. OAuth login and refresh-provider integration are separate work.
2. Call `rotateCredential(actor, credentialId, { requestId, secret })` through a trusted private
   service binding. Reuse the request ID and payload on retries. Both credential kinds follow the
   same encrypted storage, grant, configuration-version and audit flow.
3. The D1 transaction inserts the replacement, retires the previous row, copies the applicable grants
   and advances referencing configurations. Cache invalidation and configuration pushes follow.
4. Retry until `complete` is true. Inspect `credentialCoverage` and `lastUsedAt` before revoking the
   previous credential at its provider and calling `revokeCredential`. Its cleared metadata and
   encrypted R2 receipt remain. R2 failure is retryable and does not undo the D1 revocation.

Unassignment removes an agent's grant and reference. Revocation affects all grants. Every read checks
current status and grants, even with a warm plaintext cache. Missing, revoked, unassigned and expired
credentials stop with `credential_unavailable`; no alternate credential or environment key is tried.
An already-running provider request is not interrupted. Decrypted cache entries expire within five
minutes and are invalidated after management changes.

## Single-KEK replacement

This explicit maintenance operation can temporarily make credentials unavailable. It does not install
an alternate runtime key or retain old-key resolution paths.

1. Keep the previous KEK available only for this replacement operation and its retries; this does
   not require a permanent backup or recovery-custody scheme. Generate a random 32-byte replacement
   and base64 encode it using standard tooling.
2. Replace the value of the **same** `CREDENTIAL_KEK_V1` Worker Secret and deploy. Do not introduce
   a V2 binding. Until replacement starts, the durable key fingerprint rejects writes by the new
   deployment; old envelopes cannot be decrypted with its new key.
3. Through a trusted private service binding, call
   `rewrapCredentials(actor, { previousKek, previousVersion })`. The old key is write-only maintenance
   input, never stored, returned, logged, or used for normal credential resolution. The first generation
   is 1. Keep these exact inputs for retries.
4. The operation atomically advances the durable generation and fingerprint, fencing outdated
   writers. Each call leases and rewraps at most 100 old DEKs without decrypting provider payloads.
   New writes use the single installed key. Unprocessed credentials remain unavailable, not rerouted.
5. Retry until `remaining` is zero and `complete` is true. Revoked rows stay revoked with cleared
   ciphertext. Expired leases permit resuming an interrupted batch. Verify assigned working and
   memory agents. Future replacements repeat the same operation with the next generation; the
   Worker binding name never changes.

Do not serve a restored old database before replaying revocation receipts. Backup restoration is
follow-up work, not an alternate credential-resolution path.

## Leak response

Revoke a leaked credential at the provider first, then revoke it in Kodama and verify the receipt.
Inspect secret-free audit and coverage results. Redaction is defense in depth, not a substitute for
revocation. A combined leak of the KEK and D1 database is an accepted residual risk; no additional
mitigation will be pursued for that scenario, including a separate vault or split-key design.

## Operational policy

KEK loss does not require an elaborate backup-location or recovery-custody scheme. If the KEK is
lost, re-register the provider credentials rather than plan recovery of the encrypted values.

Only the KEK **rotation frequency** remains undecided. This document does not choose a schedule;
backup location, custody/access rules and per-key usage limits are not outstanding policy decisions.
Kodama is not deployed; no legacy credential formats or provider-secret migration paths are supported.
