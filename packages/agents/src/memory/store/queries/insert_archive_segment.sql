INSERT INTO archive_segments (
  id,
  agent_id,
  first_entry,
  last_entry,
  entry_count,
  r2_prefix,
  sha256,
  bytes,
  first_at,
  last_at,
  created_at
) VALUES (
  :id,
  :agentId,
  :firstEntry,
  :lastEntry,
  :entryCount,
  :r2Prefix,
  :sha256,
  :bytes,
  :firstAt,
  :lastAt,
  :createdAt
);
