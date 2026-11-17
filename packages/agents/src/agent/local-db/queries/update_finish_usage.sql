UPDATE kodama_usage
SET
  finished_at = :finishedAt,
  status = :status,
  response_model = :responseModel,
  rate_limited = :rateLimited,
  usage_state = :usageState,
  input = :input,
  output = :output,
  cache_read = :cacheRead,
  cache_write = :cacheWrite,
  total_tokens = :totalTokens,
  reasoning = :reasoning,
  cache_write_1h = :cacheWrite1h,
  input_cost = :inputCost,
  output_cost = :outputCost,
  cache_read_cost = :cacheReadCost,
  cache_write_cost = :cacheWriteCost,
  total_cost = :totalCost
WHERE seq = :seq AND status = 'in_flight';
