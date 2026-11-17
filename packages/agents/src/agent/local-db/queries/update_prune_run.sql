UPDATE kodama_prune_runs
SET
  first_entry = :firstEntry,
  last_entry = :lastEntry,
  head = :head,
  state = :state,
  entry_count = :entryCount,
  bytes = :bytes,
  sha256 = :sha256,
  first_at = :firstAt,
  last_at = :lastAt,
  updated_at = :updatedAt
WHERE id = :id
RETURNING
  id,
  first_entry AS firstEntry,
  last_entry AS lastEntry,
  head,
  state,
  entry_count AS entryCount,
  bytes,
  sha256,
  first_at AS firstAt,
  last_at AS lastAt,
  created_at AS createdAt,
  updated_at AS updatedAt;
