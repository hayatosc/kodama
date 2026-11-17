/**
 * Data-access repository for credential grants and agent credential reference indexes.
 *
 * @module
 */
import type { ManagementDb } from '../control-plane/db.ts'
import { prepareQuery } from '../lib/reylo.ts'
import type { AgentSettings } from '../protocol.ts'
import { queries } from './queries/index.ts'
import { parseCredentialRow } from './vault.repository.ts'
import type { CredentialRow } from './vault.repository.ts'

/** Check whether `agentId` holds a grant for `credentialId`. */
export async function findCredentialGrant(db: ManagementDb, credentialId: string, agentId: string) {
  return (await queries.getCredentialGrant.run(db, { credentialId, agentId })) ?? undefined
}

/** Fetch the active granted credential row for `agentId` and `provider`, if present. */
export async function findGrantedCredential(
  db: ManagementDb,
  params: { agentId: string; credentialId: string; provider: string },
): Promise<CredentialRow | undefined> {
  const row = await queries.getGrantedCredential.run(db, params)
  return row === null ? undefined : parseCredentialRow(row)
}

/** List all grant rows pointing to `credentialId`. */
export async function listCredentialGrantsByCredential(db: ManagementDb, credentialId: string) {
  return queries.listCredentialGrantsByCredential.run(db, { credentialId })
}

/** List all references to `credentialId` across current agent configs. */
export async function listCredentialReferences(db: ManagementDb, credentialId: string) {
  return queries.listCredentialReferences.run(db, { credentialId })
}

/** List Durable Object names of agents referencing `credentialId`. */
export async function listCredentialRefObjects(db: ManagementDb, credentialId: string) {
  return queries.listCredentialRefObjects.run(db, { credentialId })
}

/** Prepare a statement inserting a single credential grant. */
export function insertCredentialGrantStatement(
  db: ManagementDb,
  credentialId: string,
  agentId: string,
): D1PreparedStatement {
  return prepareQuery(db, queries.insertCredentialGrant, { credentialId, agentId })
}

/** Prepare an idempotent grant insert ignoring existing grants. */
export function insertCredentialGrantIgnoreStatement(
  db: ManagementDb,
  credentialId: string,
  agentId: string,
): D1PreparedStatement {
  return prepareQuery(db, queries.insertCredentialGrantIgnore, { credentialId, agentId })
}

/** Prepare a statement removing a credential grant from an agent. */
export function deleteCredentialGrantStatement(
  db: ManagementDb,
  credentialId: string,
  agentId: string,
): D1PreparedStatement {
  return prepareQuery(db, queries.deleteCredentialGrant, { credentialId, agentId })
}

/** Prepare initial grant statements for an authorized agent creation batch. */
export function initialGrantStatements(
  db: ManagementDb,
  agentId: string,
  settings: AgentSettings,
): D1PreparedStatement[] {
  return [...new Set(Object.values(settings.credentials?.primary ?? {}))].map((credentialId) =>
    insertCredentialGrantIgnoreStatement(db, credentialId, agentId),
  )
}

/** Prepare a statement inserting one agent credential reference index row. */
export function insertAgentCredentialRefStatement(
  db: ManagementDb,
  params: { agentId: string; provider: string; credentialId: string },
): D1PreparedStatement {
  return prepareQuery(db, queries.insertAgentCredentialRef, params)
}

/** Prepare statements replacing an agent's credential reference reverse index. */
export function referenceStatements(
  db: ManagementDb,
  agentId: string,
  settings: AgentSettings,
): D1PreparedStatement[] {
  const rows = Object.entries(settings.credentials?.primary ?? {}).map(
    ([provider, credentialId]) => ({ agentId, provider, credentialId }),
  )
  return [
    prepareQuery(db, queries.deleteAgentCredentialRefs, { agentId }),
    ...rows.map((row) => prepareQuery(db, queries.insertAgentCredentialRef, row)),
  ]
}
