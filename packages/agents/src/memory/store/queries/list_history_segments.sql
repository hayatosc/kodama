WITH input AS (
  SELECT
    :before::nullable(int) AS before_at,
    :cursorLastAt::nullable(int) AS cursor_last_at,
    :cursorLastEntry::nullable(int) AS cursor_last_entry
)
SELECT
  a.id,
  a.agent_id AS agentId,
  a.first_entry AS firstEntry,
  a.last_entry AS lastEntry,
  a.entry_count AS entryCount,
  a.r2_prefix AS r2Prefix,
  a.sha256,
  a.bytes,
  a.first_at AS firstAt,
  a.last_at AS lastAt,
  a.created_at AS createdAt
FROM archive_segments AS a
CROSS JOIN input
WHERE a.agent_id = :agentId
  AND (input.before_at IS NULL OR a.first_at < input.before_at)
  AND (
    input.cursor_last_at IS NULL
    OR a.last_at < input.cursor_last_at
    OR (a.last_at = input.cursor_last_at AND a.last_entry <= input.cursor_last_entry)
  )
ORDER BY a.last_at DESC, a.last_entry DESC
LIMIT :limit;
