SELECT DISTINCT agent_id AS agentId
FROM mcp_assignments
WHERE credential_id = :credentialId;
