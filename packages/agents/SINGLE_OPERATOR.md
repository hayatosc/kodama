# Single-operator installation

Kodama is operated by one person. It has no user registry, principals, memberships, roles, agent owners, or per-user credential scopes. Every agent and credential belongs to the installation; there is no synthetic singleton user.

## Trust boundary

Production management RPC is available only through the private service binding. Its caller must authenticate access before forwarding requests. The development HTTP adapter still requires its bearer token. Removing user identities does not make management public, and callers cannot supply an actor or claim a role through model arguments.

Direct operator input remains distinct from model output, peer messages, scheduled work, and external data. The existing send/steer path stamps the entry source; callers cannot supply that metadata. Pi's conversation submission index deduplicates the stable request ID, including concurrent sends and retries after eviction. A repeated ID returns the original submission, not new content or authority. There is no parallel reply receipt, external-message index, sequence counter, or strict sequence-gap validation. A message saying that its author is an administrator grants no authority.

Use `sendMessage` / `send` with `whenBusy: 'followUp' | 'steer'`, or the existing `cancel` RPC. CLI replies use `send --request-id ID` (and optionally `--steer`); cancellation uses `cancel`. The old owner-reply, delivery-list and delivery-report APIs are removed. There is no UI delivery ledger, `deliveryId`, or delivery accepted boundary. Attention is a read-only view of existing execution/contact state in the normal runtime views module. Submission completion and inbox read state are not UI receipt acknowledgements.

## Persistence and credentials

Configuration versions and audit entries record `operator` or `system` as provenance, not an identity or permission. Provider credentials remain encrypted, write-only, and explicitly selected and granted per agent. Revocation and refresh fencing remain in force. Envelope authentication binds the credential ID, kind, provider, and revision without a user ID.

Existing multi-user data and old encrypted envelopes are not supported by this redesign. Migrations are generated from the schema; use a fresh local installation when validating it.

MCP adds its own purpose and server binding to the same encrypted vault. Per-agent tool selection, direct-input confirmation, and OAuth browser/state/PKCE binding remain necessary even with one operator; they are not user ownership checks.
