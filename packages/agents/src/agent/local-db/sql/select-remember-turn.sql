SELECT entry_id AS entryId, count
FROM kodama_remember_turns
WHERE entry_id = :entryId;
