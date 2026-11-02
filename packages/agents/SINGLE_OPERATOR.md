# Single-operator installation

Kodama is operated by one person. It has no user registry, principals, memberships, roles, agent owners, or per-user credential scopes. Every agent and credential belongs to the installation; there is no synthetic singleton user.

## Trust boundary

Production management RPC is available only through the private service binding. Its caller must authenticate access before forwarding requests. The development HTTP adapter still requires its bearer token. Removing user identities does not make management public, and callers cannot supply an actor or claim a role through model arguments.

Direct operator input remains distinct from model output, peer messages, scheduled work, and external data. The host records immutable request IDs, external message IDs, conversation references, sequence numbers, and admitted submission references. Replayed requests must match their original arguments. A message saying that its author is an administrator grants no authority.

The existing owner-intake transport names refer to direct operator input, not to ownership of individual agents. Delivery acknowledgements remain separate from message admission, browser display, and inbox read state.

## Persistence and credentials

Configuration versions and audit entries record `operator` or `system` as provenance, not an identity or permission. Provider credentials remain encrypted, write-only, and explicitly selected and granted per agent. Revocation and refresh fencing remain in force. Envelope authentication binds the credential ID, kind, provider, and revision without a user ID.

Existing multi-user data and old encrypted envelopes are not supported by this redesign. Migrations are generated from the schema; use a fresh local installation when validating it.

MCP adds its own purpose and server binding to the same encrypted vault. Per-agent tool selection, direct-input confirmation, and OAuth browser/state/PKCE binding remain necessary even with one operator; they are not user ownership checks.
