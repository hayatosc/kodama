SELECT
  id,
  agent_id AS agentId,
  first_entry AS firstEntry,
  last_entry AS lastEntry,
  entry_count AS entryCount,
  r2_prefix AS r2Prefix,
  sha256,
  bytes,
  first_at AS firstAt,
  last_at AS lastAt,
  created_at AS createdAt
FROM archive_segments
WHERE id = :id;
