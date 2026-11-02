# MCP client v1

This package implements the agents-side MCP client. It does not expose a public HTTP endpoint,
implement a UI Worker, or connect to external chat systems. All verification uses local fixtures.

## Authority and catalog

`AgentService.mcpManage(actor, input)` is private service-binding RPC. The authenticated principal
must own a working agent. Registrations and discovered definitions are shared across the installation.
Only the registration's creator can change, invalidate, or rediscover it. Another owner can reuse
that catalog, but must supply their own server-bound credential and select tools for agents they own.
Creator changes can invalidate other owners' selections.

Registration and discovery expose **no model tools**. Assignment requires explicit tool IDs, the
current catalog digest, an owned credential, an owned working agent, and `readOnly: true`. A catalog
update never selects additions. Definitions are immutable by digest; names are fixed ASCII
`mcp_<server short ID>_<tool short ID>`. The registry changes only at the existing safe-apply boundary.
Live management checks reject revoked credentials, removed selections, changed definitions,
disabled tools, and disabled registrations before each send, including after refresh.

Management operations:

| Operation           | Input fields besides `operation`                                                    |
| ------------------- | ----------------------------------------------------------------------------------- |
| `add`               | `name`, `endpoint`                                                                  |
| `list`              | none                                                                                |
| `status`, `connect` | `serverId`                                                                          |
| `update`            | `serverId`; optional `name`, `endpoint`, `enabled`                                  |
| `discover`          | `serverId`; optional `credentialId`                                                 |
| `bearer`            | `serverId`, `secret`                                                                |
| `assign`            | `serverId`, `credentialId`, `agentId`, `toolIds`, `catalogDigest`, `readOnly: true` |
| `unassign`          | `serverId`, `agentId`                                                               |
| `disconnect`        | `serverId`, `credentialId`                                                          |

IDs in these operations are UUIDs, not agent slugs. Inspection errors are recorded separately from
registration. Unsupported schema definitions remain visible for review but cannot be assigned.

## CLI

The existing authenticated development adapter forwards to the same RPC workflows:

```sh
nr agent mcp list
nr agent mcp status SERVER_UUID
nr agent mcp connect SERVER_UUID
nr agent mcp auth-status SERVER_UUID
nr agent mcp add < registration.json
nr agent mcp discover < discovery.json
nr agent mcp assign < selection.json
nr agent mcp unassign < removal.json
```

`update`, `bearer`, `client`, `initial-token`, `attach`, and `disconnect` also take a JSON object on
stdin. Secret-bearing JSON must come from a secure source, not command-line arguments or repository
files. The CLI never receives access or refresh tokens from RPC. `connect` prints the canonical UI
link; it does not create another OAuth client or localhost callback.

## OAuth host contract

Set the non-secret `KODAMA_UI_ORIGIN` binding in `cloudflare.config.ts` to the actual canonical UI
origin before enabling browser authorization. Its checked-in empty value fails closed; no production
origin is assumed. The only redirect URI is `${KODAMA_UI_ORIGIN}/auth/mcp/callback`, and the client
metadata document URL is `${KODAMA_UI_ORIGIN}/oauth/mcp-client.json`.

The future UI Worker must authenticate Access JWT signatures, issuer and audience; authorize the
principal; protect initiation with origin/CSRF checks; and maintain a Secure, HttpOnly, SameSite=Lax
browser-binding cookie. It calls `AgentService.mcpAuth(actor, input)` over its service binding:

- `metadata`: return the fixed public client document.
- `client`: save `serverId`, `client` (issuer, clientId, method, redirectUri,
  registration `preregistered`), and optional secret. Methods are `none`, `client_secret_basic`,
  and `client_secret_post`.
- `initial-token`: save an owner-supplied DCR `secret`, bound to `serverId`, `issuer`, and `endpoint`.
- `begin`: supply `serverId`, server-side `browserNonce`, optional `issuer`, `scope`, `initialTokenId`,
  and chat `requestId`. The result contains a consent summary and authorization URL, not tokens.
- `complete`: supply the same browser binding, returned `state`, `code`, optional response `issuer`,
  or `denied: true`. A transaction can be claimed only once.
- `attach`: bind an already-owned `credentialId` to its original chat `requestId`, then resume only
  initial discovery. This is also the secure Bearer-input path for chat registration.
- `status`: supply `serverId`; receive only the caller's credential and transaction metadata.

Discovery supports protected-resource metadata, RFC 8414 and OIDC metadata, exact issuer pinning,
preregistration, metadata-document clients, and explicit dynamic registration. Authorization Code
uses PKCE S256 and a ten-minute state transaction. Principal, browser, registration revision,
issuer, client, resource, scope, and redirect URI are bound to the transaction. The UI must display
the consent summary before navigating and must never log callback codes or state. Its callback
must use `Cache-Control: no-store` and `Referrer-Policy: no-referrer` and redirect to a fixed result
page without external content. These UI routes are intentionally not implemented in this package.

MCP tokens, client secrets, initial registration tokens, and verifiers extend the existing encrypted
vault under a separate MCP purpose. They never enter provider credential references. Refresh uses
an exclusive persisted lease and revision checks; concurrent callers wait for its result. Uncertain
exchange or rotation requires reauthentication rather than replay. Disconnect invalidates locally
before best-effort AS revocation. The result distinguishes unconfirmed external revocation.

## Chat registration

The default built-in `mcp_registration` tool accepts register/status/connect/discover/assign requests,
not actor identity, credentials, or approval flags. The host verifies original owner-intake receipts,
root conversation, adopted input set, principal, and running task. Legacy `pi.user`, peer, schedule,
and mixed-origin runs cannot authorize mutations. Read-only status can be shown after a non-owner
completion event.

The deliberately limited, whole-message owner syntax is:

```text
/mcp register NAME
/mcp register NAME https://server.example/mcp
/mcp assign PROPOSAL_UUID TOOL_UUID,TOOL_UUID AGENT_UUID
```

Names resolve only against the existing catalog. Unknown or ambiguous endpoints must be clarified
in chat, never searched or invented. The host attempts initial unauthenticated inspection and asks
for a secure connection when needed. OAuth consent or credential attachment resumes discovery,
**not assignment**. A host-generated, paged proposal lists endpoint, revision, tool IDs, names,
external descriptions, and rejected definitions. Its default target is the current agent; a proposal
may target another agent owned by the same principal. Only the exact proposal/tool/agent confirmation
consumes the short-lived, single-use selection intent. A vague OK does not count, and there is no
second UI approval after that confirmation.

Progress is durable. Recovery resumes discovery or deduplicated inbox delivery, never code exchange,
assignment, or a failed tool call. Completion notices have MCP provenance, not owner provenance.

## Execution limits and external data

Only public HTTPS remote Streamable HTTP with MCP `2025-11-25` is supported. No stdio, redirects,
long-lived background stream, SSE reconnection, or automatic call replay is used. Every selected tool
has `replay: 'unsafe'`. Per-object concurrency is two; initialization is bounded to five seconds,
discovery to ten, and execution to thirty. HTTP bodies are limited to 1 MiB, discovery to 100 tools
and ten pages, schema nesting to twenty, and model output to 128 KiB. Sessions are ephemeral and
bound to the exact endpoint; deletion is best effort.

Descriptions, schemas, annotations, results, and links are external data, never permissions. They
cannot grant web-fetch URLs or alter tool policy. Unsupported image/audio/resource content is
omitted and marked; validated structured content and text are wrapped in a provenance envelope.
A list-change notification marks the catalog stale and creates an inbox notice, not a discovery.

A durable call journal records safe classifications, not arguments or outputs. An interrupted call
becomes `outcome_unknown`. Failure refusal survives model steps and eviction, and only an adopted
authenticated owner input opens a new retry epoch. Credential failures and catalog changes appear
in the existing inbox; scope expansion requires fresh owner consent.

## Local verification

Run `nr check` at the repository root. Fixtures exercise workerd RPC, D1, object SQLite, encrypted
credentials, eviction, OAuth discovery and exchange, refresh contention, chat receipts and selection,
revocation, and failure refusal. No real provider keys or external MCP connection are needed. Passing
these checks does not establish interoperability with a particular production server or browser UI.
