SELECT
  COUNT(*) AS sources,
  COALESCE(
    SUM(
      CASE
        WHEN i.updated_at IS NULL OR i.updated_at < :staleBefore OR i.caught_up = 0 THEN 1
        ELSE 0
      END
    ),
    0
  ) AS pendingSources,
  MIN(i.updated_at) AS oldestCheckedAt
FROM agents a
LEFT JOIN usage_ingestion i ON a.agent_id = i.agent_id;
