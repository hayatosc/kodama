INSERT INTO credential_grants (credential_id, agent_id)
VALUES (:credentialId, :agentId)
ON CONFLICT (credential_id, agent_id) DO NOTHING;
