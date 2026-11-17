/**
 * Barrel of typed Reylo SQL queries for `credentials`.
 *
 * @module
 */
import deleteAgentCredentialRefs from './delete_agent_credential_refs.sql'
import deleteCredentialGrant from './delete_credential_grant.sql'
import getCredentialById from './get_credential_by_id.sql'
import getCredentialGrant from './get_credential_grant.sql'
import getGrantedCredential from './get_granted_credential.sql'
import insertAgentCredentialRef from './insert_agent_credential_ref.sql'
import insertCredential from './insert_credential.sql'
import insertCredentialGrant from './insert_credential_grant.sql'
import insertCredentialGrantIgnore from './insert_credential_grant_ignore.sql'
import insertRefreshFailureAudit from './insert_refresh_failure_audit.sql'
import listCredentialGrantsByCredential from './list_credential_grants_by_credential.sql'
import listCredentialRefObjects from './list_credential_ref_objects.sql'
import listCredentialReferences from './list_credential_references.sql'
import listProviderCredentials from './list_provider_credentials.sql'
import updateClaimCredentialLease from './update_claim_credential_lease.sql'
import updateCredentialLastUsed from './update_credential_last_used.sql'
import updateCredentialModifyApiKey from './update_credential_modify_api_key.sql'
import updateCredentialModifyOauth from './update_credential_modify_oauth.sql'
import updateRefreshFailure from './update_refresh_failure.sql'
import updateReleaseCredentialLease from './update_release_credential_lease.sql'
import updateRevokeCredential from './update_revoke_credential.sql'

/** Typed SQL queries owned by `credentials`. */
export const queries = {
  deleteAgentCredentialRefs,
  deleteCredentialGrant,
  getCredentialById,
  getCredentialGrant,
  getGrantedCredential,
  insertAgentCredentialRef,
  insertCredential,
  insertCredentialGrant,
  insertCredentialGrantIgnore,
  insertRefreshFailureAudit,
  listCredentialGrantsByCredential,
  listCredentialRefObjects,
  listCredentialReferences,
  listProviderCredentials,
  updateClaimCredentialLease,
  updateCredentialLastUsed,
  updateCredentialModifyApiKey,
  updateCredentialModifyOauth,
  updateRefreshFailure,
  updateReleaseCredentialLease,
  updateRevokeCredential,
} as const
