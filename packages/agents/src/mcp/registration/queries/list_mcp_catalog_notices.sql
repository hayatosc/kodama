SELECT
  mcp_assignments.server_revision AS assignmentServerRevision,
  mcp_assignments.digest AS assignmentDigest,
  mcp_servers.enabled AS serverEnabled,
  mcp_servers.revision AS serverRevision,
  mcp_servers.catalog_version AS serverCatalogVersion,
  mcp_servers.stale AS serverStale,
  mcp_tools.present AS toolPresent,
  mcp_tools.digest AS toolDigest,
  mcp_tools.rejection AS toolRejection,
  credentials.credential_id AS credentialId,
  credentials.status AS credentialStatus,
  credentials.mcp_auth_state AS credentialMcpAuthState,
  credentials.revision AS credentialRevision,
  credential_grants.credential_id AS grantCredentialId
FROM mcp_assignments
INNER JOIN mcp_servers
  ON mcp_servers.server_id = mcp_assignments.server_id
INNER JOIN mcp_tools
  ON mcp_tools.tool_id = mcp_assignments.tool_id
INNER JOIN credentials
  ON credentials.credential_id = mcp_assignments.credential_id
LEFT JOIN credential_grants
  ON credential_grants.credential_id = mcp_assignments.credential_id
  AND credential_grants.agent_id = mcp_assignments.agent_id
WHERE mcp_assignments.agent_id = :agentId
  AND mcp_assignments.server_id = :serverId;
