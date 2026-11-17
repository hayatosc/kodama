INSERT INTO kodama_prune_runs (
  first_entry, last_entry, head, state, created_at, updated_at
) VALUES (
  :firstEntry, :lastEntry, :head, 'prepared', :createdAt, :updatedAt
)
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
