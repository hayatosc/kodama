# Credential operations

Provider credentials belong to the management D1 vault, not Worker Secrets. Only envelope keys
(KEKs) belong in Worker Secrets. Credential RPC methods on the default `AgentService` require an
active installation owner. Results contain metadata, fingerprints and last four characters only.
Never paste keys into an agent conversation, a configuration, a shell argument or a log.

## Provider-key rotation

1. Create a replacement key at the provider. Keep the old key valid during the transition.
2. Call `rotateCredential(actor, oldCredentialId, { requestId, secret })` through a trusted private
   service binding. Reuse the same request ID and secret on retries. There is no public admin HTTP
   endpoint; the development adapter is local only.
3. The D1 batch inserts the new active credential, marks the old credential retiring, copies grants
   for referencing agents, and advances all their configuration versions and reverse indexes with
   an audit event. It then invalidates caches and pushes the new versions to the objects.
4. Retry the same operation until `complete` is true. A failed push is not reported as complete.
   Requests already running may finish with the old key. Check `credentialCoverage` and
   `lastUsedAt` before removing the old provider key.
5. Revoke the old key at the provider, then call `revokeCredential`. Keep its metadata row and R2
   revocation receipt; never physically delete it. R2 failure leaves revocation incomplete and safe
   to retry. `credentialCoverage` previews affected agents before revocation.

Unassignment removes only one agent's grant and references. Revocation affects every grant.
Normally no new request uses a revoked/unassigned key after invalidation returns. If an object is
unreachable, the decrypted cache expires after at most **five minutes**. In-flight requests are not
interrupted. Explicit primary/fallback references are the only permitted fallback.

## KEK replacement (V1 to V2)

1. Back up the current KEK outside Cloudflare under controlled access. Never store a KEK beside the
   D1 backup or in a repository. Keep the previous deployment available for incident investigation,
   but do not roll back to a runtime that cannot read V2 envelopes.
2. Generate a new random 32-byte KEK, base64 encode it, and temporarily add the `CREDENTIAL_KEK_V2`
   secret binding to `cloudflare.config.ts`. Install its value as a Worker Secret without printing
   it. Deploy with both V1 and V2 present. Do not replace either secret's value in place.
3. Call `rewrapCredentials(actor)` repeatedly through a trusted service binding. Each call first
   persists write-key version 2, then handles at most 100 old rows. All registrations now use V2;
   a writer that selected V1 before the transition cannot commit an old-key envelope afterward.
4. Every live row is leased before its DEK is rewrapped; the provider ciphertext and revision remain
   unchanged. OAuth refresh and maintenance cannot both write the same leased revision. Revoked
   rows remain cleared and revoked. Expired leases permit recovery after an interrupted run.
5. Retain both KEKs until `complete` is true and `remaining` is zero. A missing/wrong KEK fails closed.
   Retry failed/incomplete batches with both original secrets unchanged. New credentials and existing
   V2 credentials remain usable while the remaining V1 rows are processed.
6. Confirm all rows report `kekVersion = 2`, exercise assigned working and memory agents, and back up
   the new KEK outside Cloudflare. Remove the V1 binding and secret only then, regenerating binding
   types with the deployment configuration. Preserve the old KEK offline for old backup recovery.
   A restored old database must not be served until its revocation receipts are replayed (the restore
   reconciliation workflow belongs to the follow-up backup issue).

The normal installation has only `CREDENTIAL_KEK_V1`. The optional V2 environment type supports
this explicit maintenance procedure; it does not generate a key or silently fall back to V1.

## Leak response

Revoke a leaked provider key **at the provider first**, then revoke it in Kodama and verify the R2
receipt. Inspect the secret-free audit and coverage results. Rotate affected provider keys and, if a
KEK may have leaked, all secrets it could decrypt as well as the KEK. Redaction is defense in depth,
not a substitute for revocation. Treat previously exported backups and logs as potentially affected.

## Operational decisions still pending

The owner has **not yet decided** provider spending limits, the location/custodian of the offline KEK
backup, recovery access approval, or rotation cadence. These are deployment prerequisites, not
assumptions supplied by this implementation. Record the decisions and rehearse recovery before
production use. Kodama has not been deployed; there is no migration from provider Worker Secrets.
