SELECT
  seq,
  started_at AS startedAt,
  finished_at AS finishedAt,
  charged_agent_id AS chargedAgentId,
  actor_kind AS actorKind,
  job_id AS jobId,
  credential_id AS credentialId,
  credential_kind AS credentialKind,
  provider,
  model,
  response_model AS responseModel,
  status,
  rate_limited AS rateLimited,
  usage_state AS usageState,
  input,
  output,
  cache_read AS cacheRead,
  cache_write AS cacheWrite,
  total_tokens AS totalTokens,
  reasoning,
  cache_write_1h AS cacheWrite1h,
  input_cost AS inputCost,
  output_cost AS outputCost,
  cache_read_cost AS cacheReadCost,
  cache_write_cost AS cacheWriteCost,
  total_cost AS totalCost,
  aggregated_at AS aggregatedAt
FROM kodama_usage
WHERE seq > :after
ORDER BY seq ASC
LIMIT :limit;
