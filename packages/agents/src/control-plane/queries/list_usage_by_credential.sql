WITH input AS (
  SELECT
    :agentId::nullable(text) AS agentId,
    :cursor::nullable(text) AS cursor
),
grouped AS (
  SELECT
    json_array(d.credential_id, d.credential_kind) AS key,
    COALESCE(SUM(d.attempts), 0) AS attempts,
    COALESCE(SUM(d.failed), 0) AS failed,
    COALESCE(SUM(d.rate_limited), 0) AS rateLimited,
    COALESCE(SUM(CASE WHEN d.usage_state = 'unknown' THEN d.attempts ELSE 0 END), 0) AS unknown,
    COALESCE(SUM(CASE WHEN d.usage_state = 'not_applicable' THEN d.attempts ELSE 0 END), 0) AS notApplicable,
    COALESCE(SUM(CASE WHEN d.usage_state = 'reported' THEN d.attempts ELSE 0 END), 0) AS reportedAttempts,
    COALESCE(SUM(CASE WHEN d.usage_state = 'reported' THEN d.input ELSE 0 END), 0) AS reportedInput,
    COALESCE(SUM(CASE WHEN d.usage_state = 'reported' THEN d.output ELSE 0 END), 0) AS reportedOutput,
    COALESCE(SUM(CASE WHEN d.usage_state = 'reported' THEN d.cache_read ELSE 0 END), 0) AS reportedCacheRead,
    COALESCE(SUM(CASE WHEN d.usage_state = 'reported' THEN d.cache_write ELSE 0 END), 0) AS reportedCacheWrite,
    COALESCE(SUM(CASE WHEN d.usage_state = 'reported' THEN d.total_tokens ELSE 0 END), 0) AS reportedTotalTokens,
    COALESCE(SUM(CASE WHEN d.usage_state = 'reported' THEN d.reasoning ELSE 0 END), 0) AS reportedReasoning,
    COALESCE(SUM(CASE WHEN d.usage_state = 'reported' THEN d.cache_write_1h ELSE 0 END), 0) AS reportedCacheWrite1h,
    COALESCE(SUM(CASE WHEN d.usage_state = 'reported' THEN d.reasoning_reported ELSE 0 END), 0) AS reportedReasoningReported,
    COALESCE(SUM(CASE WHEN d.usage_state = 'reported' THEN d.cache_write_1h_reported ELSE 0 END), 0) AS reportedCacheWrite1hReported,
    COALESCE(SUM(CASE WHEN d.usage_state = 'reported' AND d.credential_kind = 'api_key' THEN d.cost_usd ELSE 0 END), 0) AS reportedPayAsYouGoCatalogCostUsd,
    COALESCE(SUM(CASE WHEN d.usage_state = 'reported' AND d.credential_kind = 'oauth_subscription' THEN d.cost_usd ELSE 0 END), 0) AS reportedSubscriptionApiEquivalentUsd,
    COALESCE(SUM(CASE WHEN d.usage_state = 'reported' AND d.credential_kind IS NULL THEN d.cost_usd ELSE 0 END), 0) AS reportedUnattributedCatalogCostUsd,
    COALESCE(SUM(CASE WHEN d.usage_state = 'partial' THEN d.attempts ELSE 0 END), 0) AS partialAttempts,
    COALESCE(SUM(CASE WHEN d.usage_state = 'partial' THEN d.input ELSE 0 END), 0) AS partialInput,
    COALESCE(SUM(CASE WHEN d.usage_state = 'partial' THEN d.output ELSE 0 END), 0) AS partialOutput,
    COALESCE(SUM(CASE WHEN d.usage_state = 'partial' THEN d.cache_read ELSE 0 END), 0) AS partialCacheRead,
    COALESCE(SUM(CASE WHEN d.usage_state = 'partial' THEN d.cache_write ELSE 0 END), 0) AS partialCacheWrite,
    COALESCE(SUM(CASE WHEN d.usage_state = 'partial' THEN d.total_tokens ELSE 0 END), 0) AS partialTotalTokens,
    COALESCE(SUM(CASE WHEN d.usage_state = 'partial' THEN d.reasoning ELSE 0 END), 0) AS partialReasoning,
    COALESCE(SUM(CASE WHEN d.usage_state = 'partial' THEN d.cache_write_1h ELSE 0 END), 0) AS partialCacheWrite1h,
    COALESCE(SUM(CASE WHEN d.usage_state = 'partial' THEN d.reasoning_reported ELSE 0 END), 0) AS partialReasoningReported,
    COALESCE(SUM(CASE WHEN d.usage_state = 'partial' THEN d.cache_write_1h_reported ELSE 0 END), 0) AS partialCacheWrite1hReported,
    COALESCE(SUM(CASE WHEN d.usage_state = 'partial' AND d.credential_kind = 'api_key' THEN d.cost_usd ELSE 0 END), 0) AS partialPayAsYouGoCatalogCostUsd,
    COALESCE(SUM(CASE WHEN d.usage_state = 'partial' AND d.credential_kind = 'oauth_subscription' THEN d.cost_usd ELSE 0 END), 0) AS partialSubscriptionApiEquivalentUsd,
    COALESCE(SUM(CASE WHEN d.usage_state = 'partial' AND d.credential_kind IS NULL THEN d.cost_usd ELSE 0 END), 0) AS partialUnattributedCatalogCostUsd
  FROM usage_daily d
  CROSS JOIN input
  WHERE d.day >= :fromDay
    AND d.day < :toDay
    AND (input.agentId IS NULL OR d.charged_agent_id = input.agentId)
  GROUP BY json_array(d.credential_id, d.credential_kind)
)
SELECT
  CAST(grouped.key AS TEXT) AS key,
  grouped.attempts,
  grouped.failed,
  grouped.rateLimited,
  grouped.unknown,
  grouped.notApplicable,
  grouped.reportedAttempts,
  grouped.reportedInput,
  grouped.reportedOutput,
  grouped.reportedCacheRead,
  grouped.reportedCacheWrite,
  grouped.reportedTotalTokens,
  grouped.reportedReasoning,
  grouped.reportedCacheWrite1h,
  grouped.reportedReasoningReported,
  grouped.reportedCacheWrite1hReported,
  grouped.reportedPayAsYouGoCatalogCostUsd,
  grouped.reportedSubscriptionApiEquivalentUsd,
  grouped.reportedUnattributedCatalogCostUsd,
  grouped.partialAttempts,
  grouped.partialInput,
  grouped.partialOutput,
  grouped.partialCacheRead,
  grouped.partialCacheWrite,
  grouped.partialTotalTokens,
  grouped.partialReasoning,
  grouped.partialCacheWrite1h,
  grouped.partialReasoningReported,
  grouped.partialCacheWrite1hReported,
  grouped.partialPayAsYouGoCatalogCostUsd,
  grouped.partialSubscriptionApiEquivalentUsd,
  grouped.partialUnattributedCatalogCostUsd
FROM grouped
CROSS JOIN input
WHERE input.cursor IS NULL OR grouped.key > input.cursor
ORDER BY grouped.key ASC
LIMIT :limit;
