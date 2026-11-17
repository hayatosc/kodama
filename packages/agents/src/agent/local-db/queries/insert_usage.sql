INSERT INTO kodama_usage (
  charged_agent_id, actor_kind, job_id, provider, model, started_at
) VALUES (
  :chargedAgentId, :actorKind, :jobId, :provider, :model, :startedAt
)
RETURNING seq;
