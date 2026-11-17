INSERT INTO kodama_remember_turns (entry_id, count)
VALUES (:entryId, :count)
ON CONFLICT (entry_id) DO UPDATE SET count = excluded.count;
