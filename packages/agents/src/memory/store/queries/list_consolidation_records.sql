SELECT
  id,
  scope,
  kind,
  content,
  search_version AS searchVersion,
  status,
  superseded_by AS supersededBy,
  origin,
  source_agent_id AS sourceAgentId,
  source_entry_from AS sourceEntryFrom,
  source_entry_to AS sourceEntryTo,
  run_id AS runId,
  importance,
  pinned,
  overrides,
  required,
  use_count AS useCount,
  last_used_at AS lastUsedAt,
  observed_at AS observedAt,
  created_at AS createdAt,
  updated_at AS updatedAt,
  revision
FROM memory_records
WHERE scope = :scope AND status = 'active'
ORDER BY kind ASC, use_count DESC, updated_at DESC
LIMIT :limit;
