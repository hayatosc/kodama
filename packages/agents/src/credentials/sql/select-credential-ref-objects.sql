SELECT a.object_name AS objectName
FROM agent_credential_refs r
INNER JOIN agents a ON a.agent_id = r.agent_id
WHERE r.credential_id = :credentialId;
