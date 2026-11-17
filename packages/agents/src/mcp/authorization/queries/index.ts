/**
 * Barrel of typed Reylo SQL queries for `mcp/authorization`.
 *
 * @module
 */
import deleteCredentialGrantsByCredential from './delete_credential_grants_by_credential.sql'
import deleteMcpAssignmentsByCredential from './delete_mcp_assignments_by_credential.sql'
import getMcpAgentGrant from './get_mcp_agent_grant.sql'
import getMcpOauthClient from './get_mcp_oauth_client.sql'
import getMcpOauthTransactionPending from './get_mcp_oauth_transaction_pending.sql'
import getMcpSecret from './get_mcp_secret.sql'
import insertMcpCredential from './insert_mcp_credential.sql'
import insertMcpOauthClientRegistering from './insert_mcp_oauth_client_registering.sql'
import insertMcpOauthClientUpsert from './insert_mcp_oauth_client_upsert.sql'
import insertMcpOauthTransaction from './insert_mcp_oauth_transaction.sql'
import listExpiredMcpOauthTransactions from './list_expired_mcp_oauth_transactions.sql'
import listMcpOauthTransactionsByServer from './list_mcp_oauth_transactions_by_server.sql'
import listMcpServerCredentials from './list_mcp_server_credentials.sql'
import updateAttachMcpRequest from './update_attach_mcp_request.sql'
import updateClaimMcpCredentialLease from './update_claim_mcp_credential_lease.sql'
import updateClaimMcpOauthTransaction from './update_claim_mcp_oauth_transaction.sql'
import updateCompleteMcpOauthTransaction from './update_complete_mcp_oauth_transaction.sql'
import updateEraseMcpSecret from './update_erase_mcp_secret.sql'
import updateExpireMcpOauthTransaction from './update_expire_mcp_oauth_transaction.sql'
import updateFailMcpOauthTransaction from './update_fail_mcp_oauth_transaction.sql'
import updateMarkMcpAuthFailure from './update_mark_mcp_auth_failure.sql'
import updateMarkMcpCredentialNeedsReauth from './update_mark_mcp_credential_needs_reauth.sql'
import updateMarkMcpCredentialsStaleLease from './update_mark_mcp_credentials_stale_lease.sql'
import updateMcpOauthClientFailed from './update_mcp_oauth_client_failed.sql'
import updateMcpOauthClientReady from './update_mcp_oauth_client_ready.sql'
import updateSaveMcpCredentialRefresh from './update_save_mcp_credential_refresh.sql'

/** Typed SQL queries owned by `mcp/authorization`. */
export const queries = {
  deleteCredentialGrantsByCredential,
  deleteMcpAssignmentsByCredential,
  getMcpAgentGrant,
  getMcpOauthClient,
  getMcpOauthTransactionPending,
  getMcpSecret,
  insertMcpCredential,
  insertMcpOauthClientRegistering,
  insertMcpOauthClientUpsert,
  insertMcpOauthTransaction,
  listExpiredMcpOauthTransactions,
  listMcpOauthTransactionsByServer,
  listMcpServerCredentials,
  updateAttachMcpRequest,
  updateClaimMcpCredentialLease,
  updateClaimMcpOauthTransaction,
  updateCompleteMcpOauthTransaction,
  updateEraseMcpSecret,
  updateExpireMcpOauthTransaction,
  updateFailMcpOauthTransaction,
  updateMarkMcpAuthFailure,
  updateMarkMcpCredentialNeedsReauth,
  updateMarkMcpCredentialsStaleLease,
  updateMcpOauthClientFailed,
  updateMcpOauthClientReady,
  updateSaveMcpCredentialRefresh,
} as const
