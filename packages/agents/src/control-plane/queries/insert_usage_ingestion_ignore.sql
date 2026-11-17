INSERT INTO usage_ingestion (agent_id, updated_at)
VALUES (:agentId, 0)
ON CONFLICT (agent_id) DO NOTHING;
